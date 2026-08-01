import { error, info } from "@tauri-apps/plugin-log";
import { ORDINARY_ROLES, type EngineRole, type ValidatedCompanionProfile } from "../profiles/types";
import { selectWeightedOrdinaryRole } from "../profiles/weightedState";
import type { OverlayGeometry, Rectangle } from "../runtime/geometry";
import { calculateReleaseVelocity } from "../runtime/releaseVelocity";
import { getSpriteCentersInsideBounds, selectWorldBoundaryAction } from "../runtime/worldBounds";
import { Direction, Ease } from "../types/IPet";
import { ConfigManager, InputManager } from "./manager";

const RUNTIME_UPDATE_INTERVAL_MS = 1000 / 9;

interface Pet extends Phaser.Types.Physics.Arcade.SpriteWithDynamicBody {
    direction: Direction;
    role: EngineRole;
    canRandomFlip: boolean;
}

interface SceneRegistry {
    readonly profile: ValidatedCompanionProfile;
    readonly geometry: OverlayGeometry;
    readonly startupReady: () => void;
    readonly startupAbort: () => void;
}

export default class Pets extends Phaser.Scene {
    private profile!: ValidatedCompanionProfile;
    private geometry!: OverlayGeometry;
    private configManager!: ConfigManager;
    private inputManager!: InputManager;
    private pet: Pet | undefined;
    private frameElapsedMs = 0;
    private nextOrdinaryTransitionAt = 0;
    private startupFailed = false;

    constructor() {
        super({ key: "Pets" });
    }

    preload(): void {
        const registry = this.readRegistry();
        this.profile = registry.profile;
        this.geometry = registry.geometry;
        this.configManager = new ConfigManager(this.profile);
        this.inputManager = new InputManager(this.geometry);
        this.configManager.setManagers({ load: this.load, anims: this.anims });
        this.inputManager.setInputManager(this.input);
        this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
            this.startupFailed = true;
            registry.startupAbort();
        });
        this.configManager.loadSpriteSheet();
    }

    create(): void {
        if (this.startupFailed) return;
        try {
            this.configManager.registerAnimations();
            this.applyWorkAreaBounds();
            this.pet = this.createCompanion();
            this.registerDragBehavior();
            this.registerWorldBoundsBehavior();
            this.startInitialBehavior();
            this.readRegistry().startupReady();
            info("Companion scene ready");
        } catch (reason) {
            error(`Companion scene startup failed: ${String(reason)}`);
            this.readRegistry().startupAbort();
        }
    }

    update(_time: number, delta: number): void {
        const pet = this.pet;
        if (!pet) return;

        this.frameElapsedMs += delta;
        if (this.frameElapsedMs < RUNTIME_UPDATE_INTERVAL_MS) return;
        this.frameElapsedMs = 0;

        this.inputManager.checkIsMouseOverPet();
        this.updateOrdinaryBehavior(pet);
        this.updateClimbAndCrawlBehavior(pet);
    }

    private readRegistry(): SceneRegistry {
        return {
            profile: this.game.registry.get("profile") as ValidatedCompanionProfile,
            geometry: this.game.registry.get("geometry") as OverlayGeometry,
            startupReady: this.game.registry.get("startupReady") as () => void,
            startupAbort: this.game.registry.get("startupAbort") as () => void,
        };
    }

    private applyWorkAreaBounds(): void {
        const { x, y, width, height } = this.geometry.workArea;
        this.physics.world.setBounds(x, y, width, height);
        this.physics.world.setBoundsCollision(true, true, true, true);
    }

    private createCompanion(): Pet {
        const bounds = this.geometry.workArea;
        const halfWidth = (this.profile.frame.frameWidth * this.profile.behavior.scale) / 2;
        const halfHeight = (this.profile.frame.frameHeight * this.profile.behavior.scale) / 2;
        const minX = Math.ceil(bounds.x + halfWidth);
        const maxX = Math.floor(bounds.x + bounds.width - halfWidth);
        const startX = Phaser.Math.Between(minX, Math.max(minX, maxX));
        const startY = bounds.y + halfHeight;
        const pet = this.physics.add
            .sprite(startX, startY, this.profile.id)
            .setScale(this.profile.behavior.scale)
            .setInteractive({
                draggable: this.profile.behavior.dragging.enabled,
                pixelPerfect: true,
            }) as Pet;

        pet.setCollideWorldBounds(true, 0, 0, true);
        pet.direction = Direction.UNKNOWN;
        pet.role = "stand";
        pet.canRandomFlip = true;
        return pet;
    }

    private registerDragBehavior(): void {
        if (!this.profile.behavior.dragging.enabled) return;

        this.input.on("dragstart", (_pointer: unknown, pet: Pet) => {
            pet.disableBody();
        });

        this.input.on("drag", (_pointer: unknown, pet: Pet, dragX: number, dragY: number) => {
            pet.setPosition(dragX, dragY);
            this.switchRole(pet, "drag");

            const dragStartX = pet.input?.dragStartX ?? pet.x;
            this.setPetLookToTheLeft(pet, pet.x <= dragStartX);
        });

        this.input.on("dragend", (pointer: Phaser.Input.Pointer, pet: Pet) => {
            const dragging = this.profile.behavior.dragging;
            const transitions = this.profile.behavior.supportedTransitions;
            this.clampPetInsideWorkArea(pet);

            if (!transitions.dragToThrow) {
                pet.enableBody(true, pet.x, pet.y);
                this.recoverAfterInteraction(pet);
                return;
            }

            const velocity = calculateReleaseVelocity(
                pointer.velocity,
                dragging.throwVelocityMultiplier,
                dragging.maxThrowSpeed,
            );
            this.switchRole(pet, "jump");
            pet.enableBody(true, pet.x, pet.y);
            pet.body.setAllowGravity(true);
            pet.setAcceleration(0, this.profile.behavior.movement.acceleration);
            pet.setVelocity(velocity.x, velocity.y);
        });
    }

    private registerWorldBoundsBehavior(): void {
        this.physics.world.on(
            "worldbounds",
            (
                body: Phaser.Physics.Arcade.Body,
                up: boolean,
                down: boolean,
                left: boolean,
                right: boolean,
            ) => {
                const pet = body.gameObject as Pet;
                const transitions = this.profile.behavior.supportedTransitions;
                const action = selectWorldBoundaryAction(
                    pet.role,
                    { up, down, left, right },
                    transitions.crawlEdgeToJump,
                    this.profile.behavior.climbing.enabled && transitions.climbToCrawl,
                );

                switch (action) {
                    case "crawl-edge-jump":
                        this.beginJump(pet);
                        break;
                    case "ceiling-crawl":
                        this.switchRole(pet, "crawl");
                        break;
                    case "ceiling-fall":
                        this.beginJump(pet);
                        break;
                    case "landing":
                        this.finishLanding(pet);
                        break;
                    case "side":
                        this.handleSideBoundary(pet, left, right, down);
                        break;
                }
            },
        );
    }

    private startInitialBehavior(): void {
        if (this.profile.behavior.supportedTransitions.initialDrop) {
            this.beginJump(this.pet!);
        } else {
            this.playOrdinaryState(this.pet!);
        }
    }

    private beginJump(pet: Pet): void {
        this.switchRole(pet, "jump");
    }

    private finishLanding(pet: Pet): void {
        const transitions = this.profile.behavior.supportedTransitions;
        if (pet.role === "jump") {
            if (transitions.jumpToFall) {
                this.switchRole(pet, "fall", { repeat: 0 });
                pet.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
                    if (pet.active && pet.role === "fall") this.playOrdinaryState(pet);
                });
            } else {
                this.playOrdinaryState(pet);
            }
            return;
        }

        if (
            ORDINARY_ROLES.includes(pet.role as (typeof ORDINARY_ROLES)[number]) &&
            this.time.now >= this.nextOrdinaryTransitionAt
        ) {
            this.playOrdinaryState(pet);
        }
    }

    private playOrdinaryState(pet: Pet): void {
        const role = selectWeightedOrdinaryRole(
            this.profile.behavior.ordinaryTransitions.weights,
            Math.random(),
        );
        this.switchRole(pet, role);
        this.nextOrdinaryTransitionAt =
            this.time.now + this.profile.behavior.ordinaryTransitions.cooldownMs;
    }

    private updateOrdinaryBehavior(pet: Pet): void {
        if (!ORDINARY_ROLES.includes(pet.role as (typeof ORDINARY_ROLES)[number])) return;
        if (!this.getBounds(pet).down) return;

        if (this.time.now >= this.nextOrdinaryTransitionAt) this.playOrdinaryState(pet);

        const flip = this.profile.behavior.flip;
        if (!flip.enabled || !pet.canRandomFlip) return;
        const sample = Phaser.Math.Between(0, flip.sampleMax);
        if (sample < flip.triggerMin || sample > flip.triggerMax) return;

        this.toggleFlipXThenUpdateDirection(pet);
        pet.canRandomFlip = false;
        window.setTimeout(() => {
            if (pet.active) pet.canRandomFlip = true;
        }, flip.cooldownMs);
    }

    private updateClimbAndCrawlBehavior(pet: Pet): void {
        if (pet.role !== "climb" && pet.role !== "crawl") return;
        const climbing = this.profile.behavior.climbing;
        const jumpSample = Phaser.Math.Between(0, climbing.randomJumpSampleMax);
        if (jumpSample === climbing.randomJumpTrigger) {
            this.jumpFromSurface(pet);
            return;
        }

        const pauseSample = Phaser.Math.Between(0, climbing.pauseSampleMax);
        if (pauseSample > climbing.pauseTriggerMax || !pet.anims.isPlaying) return;
        const pausedRole = pet.role;
        pet.anims.pause();
        this.updateDirection(pet, Direction.UNKNOWN);
        pet.body.setAllowGravity(false);
        window.setTimeout(() => {
            if (!pet.active || pet.role !== pausedRole || pet.anims.isPlaying) return;
            pet.anims.resume();
            this.updateDirection(
                pet,
                pausedRole === "climb"
                    ? Direction.UP
                    : pet.scaleX < 0
                      ? Direction.UPSIDELEFT
                      : Direction.UPSIDERIGHT,
            );
        }, Phaser.Math.Between(climbing.pauseMinMs, climbing.pauseMaxMs));
    }

    private jumpFromSurface(pet: Pet): void {
        const centers = this.getCenters(pet);
        const targetX =
            pet.role === "climb"
                ? Phaser.Math.Between(Math.ceil(centers.left), Math.floor(centers.right))
                : pet.x;
        pet.body.enable = false;
        this.switchRole(pet, "jump");
        this.tweens.add({
            targets: pet,
            x: targetX,
            y: centers.bottom,
            duration: this.profile.behavior.climbing.jumpDurationMs,
            ease: Ease.QuadEaseOut,
            onComplete: () => {
                pet.body.enable = true;
                this.finishLanding(pet);
            },
        });
    }

    private recoverAfterInteraction(pet: Pet): void {
        const bounds = this.getBounds(pet);
        if (bounds.left || bounds.right) {
            this.handleSideBoundary(pet, bounds.left, bounds.right, bounds.down);
        } else if (bounds.down) {
            this.playOrdinaryState(pet);
        } else {
            this.beginJump(pet);
        }
    }

    private handleSideBoundary(pet: Pet, left: boolean, right: boolean, down: boolean): void {
        const transitions = this.profile.behavior.supportedTransitions;
        if (
            this.profile.behavior.climbing.enabled &&
            transitions.wallToClimb &&
            (left || right)
        ) {
            const centers = this.getCenters(pet);
            pet.setX(left ? centers.left : centers.right);
            this.setPetLookToTheLeft(pet, left);
            this.switchRole(pet, "climb");
            return;
        }

        if (down) {
            this.toggleFlipXThenUpdateDirection(pet);
        } else {
            this.beginJump(pet);
        }
    }

    private clampPetInsideWorkArea(pet: Pet): void {
        const centers = this.getCenters(pet);
        pet.setPosition(
            Phaser.Math.Clamp(pet.x, centers.left, centers.right),
            Phaser.Math.Clamp(pet.y, centers.top, centers.bottom),
        );
    }

    private switchRole(
        pet: Pet,
        role: EngineRole,
        options: { readonly repeat?: number; readonly delay?: number; readonly repeatDelay?: number } = {},
    ): void {
        try {
            const animationKey = this.configManager.getAnimationKeyForRole(role);
            if (pet.role === role && pet.anims.getName() === animationKey && pet.anims.isPlaying) return;
            pet.role = role;
            pet.anims.play({
                key: animationKey,
                repeat: options.repeat ?? -1,
                delay: options.delay ?? 0,
                repeatDelay: options.repeatDelay ?? 0,
            });
            this.updateStateDirection(pet, role);
        } catch (reason) {
            error(`Failed to switch companion state: ${String(reason)}`);
        }
    }

    private updateStateDirection(pet: Pet, role: EngineRole): void {
        switch (role) {
            case "walk":
                this.updateDirection(pet, pet.scaleX < 0 ? Direction.LEFT : Direction.RIGHT);
                break;
            case "jump":
                this.toggleFlipX(pet);
                this.updateDirection(pet, Direction.DOWN);
                break;
            case "climb":
                this.updateDirection(pet, Direction.UP);
                break;
            case "crawl":
                this.updateDirection(
                    pet,
                    pet.scaleX > 0 ? Direction.UPSIDELEFT : Direction.UPSIDERIGHT,
                );
                break;
            default:
                this.updateDirection(pet, Direction.UNKNOWN);
        }
    }

    private updateDirection(pet: Pet, direction: Direction): void {
        pet.direction = direction;
        const { speed, acceleration } = this.profile.behavior.movement;
        switch (direction) {
            case Direction.RIGHT:
                pet.setVelocity(speed, 0).setAcceleration(0);
                this.setPetLookToTheLeft(pet, false);
                break;
            case Direction.LEFT:
                pet.setVelocity(-speed, 0).setAcceleration(0);
                this.setPetLookToTheLeft(pet, true);
                break;
            case Direction.UP:
                pet.setVelocity(0, -speed).setAcceleration(0);
                break;
            case Direction.DOWN:
                pet.setVelocity(0, speed).setAcceleration(0, acceleration);
                break;
            case Direction.UPSIDELEFT:
                pet.setVelocity(-speed, -speed).setAcceleration(0);
                this.setPetLookToTheLeft(pet, true);
                break;
            case Direction.UPSIDERIGHT:
                pet.setVelocity(speed, -speed).setAcceleration(0);
                this.setPetLookToTheLeft(pet, false);
                break;
            default:
                pet.setVelocity(0).setAcceleration(0);
        }

        const surfaceMovement = [
            Direction.UP,
            Direction.UPSIDELEFT,
            Direction.UPSIDERIGHT,
        ].includes(direction);
        pet.body.setAllowGravity(!surfaceMovement);
        if (direction === Direction.UP) pet.setVelocityX(0);
    }

    private setPetLookToTheLeft(pet: Pet, left: boolean): void {
        if ((left && pet.scaleX > 0) || (!left && pet.scaleX < 0)) this.toggleFlipX(pet);
    }

    private toggleFlipX(pet: Pet): void {
        pet.scaleX > 0 ? pet.setOffset(pet.width, 0) : pet.setOffset(0, 0);
        pet.setScale(-pet.scaleX, pet.scaleY);
    }

    private toggleFlipXThenUpdateDirection(pet: Pet): void {
        this.toggleFlipX(pet);
        const opposite: Partial<Record<Direction, Direction>> = {
            [Direction.RIGHT]: Direction.LEFT,
            [Direction.LEFT]: Direction.RIGHT,
            [Direction.UPSIDELEFT]: Direction.UPSIDERIGHT,
            [Direction.UPSIDERIGHT]: Direction.UPSIDELEFT,
        };
        const direction = opposite[pet.direction];
        if (direction) this.updateDirection(pet, direction);
    }

    private getCenters(pet: Pet) {
        return getSpriteCentersInsideBounds(this.geometry.workArea, pet);
    }

    private getBounds(pet: Pet): Record<"up" | "down" | "left" | "right", boolean> {
        const centers = this.getCenters(pet);
        return {
            up: pet.y <= centers.top,
            down: pet.y >= centers.bottom,
            left: pet.x <= centers.left,
            right: pet.x >= centers.right,
        };
    }
}

export function getWorldBounds(geometry: OverlayGeometry): Rectangle {
    return geometry.workArea;
}
