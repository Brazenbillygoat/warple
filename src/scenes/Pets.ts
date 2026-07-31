import { ISpriteConfig } from "../types/ISpriteConfig";
import { useSettingStore } from "../hooks/useSettingStore";
import { listen } from "@tauri-apps/api/event";
import {
    DispatchType,
    EventType,
    TRenderEventListener,
} from "../types/IEvents";
import {
    Direction,
    IWorldBounding,
    ISwitchStateOptions,
    Ease,
} from "../types/IPet";
import { info, error } from "@tauri-apps/plugin-log";
import defaultSettings from "../../src-tauri/src/app/default/settings.json";
import { ConfigManager, InputManager } from "./manager";

interface Pet extends Phaser.Types.Physics.Arcade.SpriteWithDynamicBody {
    direction?: Direction;
    availableStates: string[];
    canPlayRandomState: boolean;
    canRandomFlip: boolean;
    id: string;
}

// This is the live desktop scene; the settings preview uses the smaller Pet scene.
export default class Pets extends Phaser.Scene {
    private pets: Pet[] = [];
    private isFlipped: boolean = false;
    private frameCount: number = 0;
    // Track climbers separately so the update loop only checks pets that need wall behavior.
    private petClimbAndCrawlIndex: number[] = [];

    private configManager: ConfigManager;
    private inputManager: InputManager;

    private allowPetInteraction: boolean;
    private allowPetAboveTaskbar: boolean;
    private allowOverridePetScale: boolean;
    private petScale: number;
    private allowPetClimbing: boolean;

    private readonly FORBIDDEN_RAND_STATE: string[] = [
        "fall",
        "climb",
        "drag",
        "crawl",
        "drag",
        "bounce",
        "jump",
    ];
    private readonly FRAME_RATE: number = 9;
    private readonly UPDATE_DELAY: number = 1000 / this.FRAME_RATE;
    private readonly PET_MOVE_VELOCITY: number = this.FRAME_RATE * 6;
    private readonly PET_MOVE_ACCELERATION: number = this.PET_MOVE_VELOCITY * 2;
    private readonly TWEEN_ACCELERATION: number = this.FRAME_RATE * 1.1;
    private readonly RAND_STATE_DELAY: number = 3000;
    private readonly FLIP_DELAY: number = 5000;

    constructor() {
        super({ key: "Pets" });

        // Read settings here because Phaser has not created scene systems such as input yet.
        this.allowPetInteraction =
            useSettingStore.getState().allowPetInteraction ??
            defaultSettings.allowPetInteraction;
        this.allowPetAboveTaskbar =
            useSettingStore.getState().allowPetAboveTaskbar ??
            defaultSettings.allowPetAboveTaskbar;
        this.allowOverridePetScale =
            useSettingStore.getState().allowOverridePetScale ??
            defaultSettings.allowOverridePetScale;
        this.petScale =
            useSettingStore.getState().petScale ?? defaultSettings.petScale;
        this.allowPetClimbing =
            useSettingStore.getState().allowPetClimbing ??
            defaultSettings.allowPetClimbing;

        this.configManager = new ConfigManager({
            FRAME_RATE: this.FRAME_RATE,
        });
        this.inputManager = new InputManager();
    }

    preload(): void {
        this.configManager.setConfigManager({
            load: this.load,
            textures: this.textures,
            anims: this.anims,
        });

        this.inputManager.setInputManager({ input: this.input });
        const spriteConfig = this.game.registry.get("spriteConfig");
        this.configManager.setSpriteConfig(spriteConfig);
        this.configManager.loadAllSpriteSheet();
    }

    create(): void {
        this.inputManager.turnOnIgnoreCursorEvents();
        this.physics.world.setBoundsCollision(true, true, true, true);
        this.updatePetAboveTaskbar();

        let i = 0;
        for (const sprite of this.configManager.getSpriteConfig()) {
            this.addPet(sprite, i);
            i++;
        }

        // Dragging temporarily hands control from Arcade physics to the pointer and a release tween.
        this.input.on(
            "drag",
            (pointer: any, pet: Pet, dragX: number, dragY: number) => {
                pet.x = dragX;
                pet.y = dragY;

                if (
                    pet.anims &&
                    pet.anims.getName() !==
                        this.configManager.getStateName("drag", pet)
                ) {
                    this.switchState(pet, "drag");
                }

                // Disable the body so world bounds do not fight pointer-controlled positioning.
                // @ts-ignore
                if (pet.body!.enable) pet.body!.enable = false;

                // Face the pet toward the current drag direction.
                if (pet.x > pet.input!.dragStartX) {
                    if (this.isFlipped) {
                        this.toggleFlipX(pet);
                        this.isFlipped = false;
                    }
                } else {
                    if (!this.isFlipped) {
                        this.toggleFlipX(pet);
                        this.isFlipped = true;
                    }
                }
            }
        );

        this.input.on("dragend", (pointer: any, pet: Pet) => {
            // Convert pointer velocity into a short throw before Arcade physics resumes.
            this.tweens.add({
                targets: pet,
                x: pet.x + pointer.velocity.x * this.TWEEN_ACCELERATION,
                y: pet.y + pointer.velocity.y * this.TWEEN_ACCELERATION,
                duration: 600,
                ease: Ease.QuartEaseOut,
                onComplete: () => {
                    // Restore collisions after the throw so the pet settles back inside the screen.
                    if (!pet.body!.enable) {
                        pet.body!.enable = true;

                        // Arcade clears velocity when re-enabled, so restore wall movement on the next tick.
                        setTimeout(() => {
                            switch (pet.anims.getName()) {
                                case this.configManager.getStateName(
                                    "climb",
                                    pet
                                ):
                                    this.updateDirection(pet, Direction.UP);
                                    break;
                                case this.configManager.getStateName(
                                    "crawl",
                                    pet
                                ):
                                    this.updateDirection(
                                        pet,
                                        pet.scaleX === -1
                                            ? Direction.UPSIDELEFT
                                            : Direction.UPSIDERIGHT
                                    );
                                    break;
                                default:
                                    return;
                            }
                        }, 50);
                    }
                },
            });

            this.petBeyondScreenSwitchClimb(pet, {
                up: this.getPetBoundTop(pet),
                down: this.getPetBoundDown(pet),
                left: this.getPetBoundLeft(pet),
                right: this.getPetBoundRight(pet),
            });
        });

        this.physics.world.on(
            "worldbounds",
            (
                body: Phaser.Physics.Arcade.Body,
                up: boolean,
                down: boolean,
                left: boolean,
                right: boolean
            ) => {
                const pet = body.gameObject as Pet;
                // Crawlers leave the ceiling when they reach either side wall.
                if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("crawl", pet)
                ) {
                    if (left || right) {
                        this.petJumpOrPlayRandomState(pet);
                    }
                    return;
                }

                if (up) {
                    if (!this.allowPetClimbing) {
                        this.petJumpOrPlayRandomState(pet);
                        return;
                    }

                    if (pet.availableStates.includes("crawl")) {
                        this.switchState(pet, "crawl");
                        return;
                    }
                    this.petJumpOrPlayRandomState(pet);
                } else if (down) {
                    this.switchStateAfterPetJump(pet);
                    this.petOnTheGroundPlayRandomState(pet);
                }

                // Boundary recovery also handles pets released outside the visible world.
                this.petBeyondScreenSwitchClimb(pet, {
                    up: up,
                    down: down,
                    left: left,
                    right: right,
                });
            }
        );

        // Settings live in another webview, so apply its events directly to the active scene.
        listen<TRenderEventListener["payload"]>(
            EventType.SettingWindowToPetOverlay,
            (event) => {
                switch (event.payload.dispatchType) {
                    case DispatchType.SwitchAllowPetInteraction:
                        this.allowPetInteraction = event.payload
                            .value as boolean;
                        break;
                    case DispatchType.SwitchPetAboveTaskbar:
                        this.allowPetAboveTaskbar = event.payload
                            .value as boolean;
                        this.updatePetAboveTaskbar();

                        // Re-evaluate movement after the floor expands to include the taskbar area.
                        if (!this.allowPetAboveTaskbar) {
                            this.pets.forEach((pet) => {
                                this.petJumpOrPlayRandomState(pet);
                            });
                        }

                        break;
                    case DispatchType.AddPet:
                        this.addPet(
                            event.payload!.value as ISpriteConfig,
                            this.pets.length
                        );
                        break;
                    case DispatchType.RemovePet:
                        this.removePet(event.payload.value as string);
                        break;
                    case DispatchType.OverridePetScale:
                        this.allowOverridePetScale = event.payload
                            .value as boolean;
                        this.allowOverridePetScale
                            ? this.scaleAllPets(this.petScale)
                            : this.scaleAllPets(defaultSettings.petScale);
                        break;
                    case DispatchType.SwitchAllowPetClimbing:
                        this.allowPetClimbing = event.payload.value as boolean;

                        // Move current climbers into a legal state as soon as climbing is disabled.
                        if (!this.allowPetClimbing) {
                            this.pets.forEach((pet) => {
                                this.petJumpOrPlayRandomState(pet);
                            });
                        }
                        break;
                    case DispatchType.ChangePetScale:
                        this.petScale = event.payload.value as number;
                        this.scaleAllPets(this.petScale);
                        break;
                    default:
                        break;
                }
            }
        );

        info("Pets scene loaded");
    }

    update(time: number, delta: number): void {
        this.frameCount += delta;

        if (this.frameCount >= this.UPDATE_DELAY) {
            this.frameCount = 0;
            if (this.allowPetInteraction) {
                this.inputManager.checkIsMouseInOnPet();
            }

            this.randomJumpIfPetClimbAndCrawl();
        }
    }

    addPet(sprite: ISpriteConfig, index: number): void {
        this.configManager.registerSpriteStateAnimation(sprite);

        const randomX = Phaser.Math.Between(
            100,
            this.physics.world.bounds.width - 100
        );
        // New pets enter from above so their initial physics state looks intentional.
        const petY = 0 + this.configManager.getFrameSize(sprite).frameHeight;
        this.pets[index] = this.physics.add
            .sprite(randomX, petY, sprite.name)
            .setInteractive({
                draggable: true,
                pixelPerfect: true,
            }) as Pet;

        this.allowOverridePetScale
            ? this.scalePet(this.pets[index], this.petScale)
            : this.scalePet(this.pets[index], defaultSettings.petScale);

        this.pets[index].setCollideWorldBounds(true, 0, 0, true);

        // Keep raw state names on the instance while animation keys remain texture-namespaced.
        this.pets[index].availableStates = Object.keys(sprite.states);
        this.pets[index].canPlayRandomState = true;
        this.pets[index].canRandomFlip = true;
        this.pets[index].id = sprite.id as string;

        this.petJumpOrPlayRandomState(this.pets[index]);
    }

    removePet(petId: string): void {
        this.pets = this.pets.filter((pet: Pet, index: number) => {
            if (pet.id === petId) {
                pet.destroy();

                const petsWithSameTexture = this.pets.filter(
                    (pet: Pet) =>
                        pet.texture.key === this.pets[index].texture.key
                );

                // Remove the shared texture only when this was its final pet instance.
                if (petsWithSameTexture.length === 1) {
                    this.textures.remove(pet.texture.key);
                }

                // Stop update-loop work for a climber that no longer exists.
                if (this.petClimbAndCrawlIndex.includes(index)) {
                    this.petClimbAndCrawlIndex =
                        this.petClimbAndCrawlIndex.filter((i) => i !== index);
                }
                return false;
            }
            return true;
        });
    }

    updateDirection(pet: Pet, direction: Direction): void {
        pet.direction = direction;
        this.updateMovement(pet);
    }

    updateStateDirection(pet: Pet, state: string): void {
        let direction = Direction.UNKNOWN;

        switch (state) {
            case "walk":
                // Signed scale is the source of truth for horizontal facing.
                direction = pet.scaleX < 0 ? Direction.LEFT : Direction.RIGHT;
                break;
            case "jump":
                // Flip each jump to vary the pet's landing direction.
                this.toggleFlipX(pet);
                direction = Direction.DOWN;
                break;
            case "climb":
                direction = Direction.UP;
                break;
            case "crawl":
                pet.scaleX > 0
                    ? (direction = Direction.UPSIDELEFT)
                    : (direction = Direction.UPSIDERIGHT);
                break;
            default:
                direction = Direction.UNKNOWN;
                break;
        }

        this.updateDirection(pet, direction);
    }

    updateMovement(pet: Pet): void {
        switch (pet.direction) {
            case Direction.RIGHT:
                pet.setVelocity(this.PET_MOVE_VELOCITY, 0);
                pet.setAcceleration(0);
                this.setPetLookToTheLeft(pet, false);
                break;
            case Direction.LEFT:
                pet.setVelocity(-this.PET_MOVE_VELOCITY, 0);
                pet.setAcceleration(0);
                this.setPetLookToTheLeft(pet, true);
                break;
            case Direction.UP:
                pet.setVelocity(0, -this.PET_MOVE_VELOCITY);
                pet.setAcceleration(0);
                break;
            case Direction.DOWN:
                pet.setVelocity(0, this.PET_MOVE_VELOCITY);
                pet.setAcceleration(0, this.PET_MOVE_ACCELERATION);
                break;
            case Direction.UPSIDELEFT:
                pet.setVelocity(-this.PET_MOVE_VELOCITY);
                pet.setAcceleration(0);
                this.setPetLookToTheLeft(pet, true);
                break;
            case Direction.UPSIDERIGHT:
                pet.setVelocity(
                    this.PET_MOVE_VELOCITY,
                    -this.PET_MOVE_VELOCITY
                );
                pet.setAcceleration(0);
                this.setPetLookToTheLeft(pet, false);
                break;
            case Direction.UNKNOWN:
                pet.setVelocity(0);
                pet.setAcceleration(0);
                break;
            default:
                pet.setVelocity(0);
                pet.setAcceleration(0);
                break;
        }

        // Wall and ceiling movement must opt out of downward gravity.
        const isMovingUp = [
            Direction.UP,
            Direction.UPSIDELEFT,
            Direction.UPSIDERIGHT,
        ].includes(pet.direction as Direction);

        // @ts-ignore
        pet.body!.setAllowGravity(!isMovingUp);

        if (pet.direction === Direction.UP) {
            pet.setVelocityX(0);
        }
    }

    switchState(
        pet: Pet,
        state: string,
        options: ISwitchStateOptions = {
            repeat: -1,
            delay: 0,
            repeatDelay: 0,
        }
    ): void {
        try {
            // Delayed transitions can outlive a destroyed pet, so treat missing animation state as cancellation.
            if (!pet.anims) return;

            // A live settings change can invalidate a queued climb or crawl transition.
            if (!this.allowPetClimbing) {
                if (state === "climb" || state === "crawl") return;
            }

            const animationKey = this.configManager.getStateName(state, pet);
            if (pet.anims && pet.anims.getName() === animationKey) return;
            if (!pet.availableStates.includes(state)) return;

            pet.anims.play({
                key: animationKey,
                repeat: options.repeat,
                delay: options.delay,
                repeatDelay: options.repeatDelay,
            });

            if (state === "climb" || state === "crawl") {
                this.petClimbAndCrawlIndex.push(this.pets.indexOf(pet));
            } else {
                this.petClimbAndCrawlIndex = this.petClimbAndCrawlIndex.filter(
                    (index) => index !== this.pets.indexOf(pet)
                );
            }

            this.updateStateDirection(pet, state);
        } catch (err: any) {
            error(err);
        }
    }

    setPetLookToTheLeft(pet: Pet, lookToTheLeft: boolean): void {
        if (lookToTheLeft) {
            if (pet.scaleX > 0) {
                this.toggleFlipX(pet);
            }
            return;
        }

        if (pet.scaleX < 0) {
            this.toggleFlipX(pet);
        }
    }

    scalePet(pet: Pet, scaleValue: number): void {
        const scaleX = pet.scaleX > 0 ? scaleValue : -scaleValue;
        const scaleY = pet.scaleY > 0 ? scaleValue : -scaleValue;
        pet.setScale(scaleX, scaleY);
    }

    scaleAllPets(scaleValue: number): void {
        this.pets.forEach((pet) => {
            this.scalePet(pet, scaleValue);

            // Re-enter behavior so resized hitboxes do not remain embedded in a boundary.
            this.petJumpOrPlayRandomState(pet);
        });
    }

    toggleFlipX(pet: Pet): void {
        // Use signed scale instead of flipX so the Arcade hitbox mirrors with the sprite.
        pet.scaleX > 0 ? pet.setOffset(pet.width, 0) : pet.setOffset(0, 0);
        pet.setScale(pet.scaleX * -1, pet.scaleY);
    }

    toggleFlipXThenUpdateDirection(pet: Pet): void {
        this.toggleFlipX(pet);

        switch (pet.direction) {
            case Direction.RIGHT:
                this.updateDirection(pet, Direction.LEFT);
                break;
            case Direction.LEFT:
                this.updateDirection(pet, Direction.RIGHT);
                break;
            case Direction.UPSIDELEFT:
                this.updateDirection(pet, Direction.UPSIDERIGHT);
                break;
            case Direction.UPSIDERIGHT:
                this.updateDirection(pet, Direction.UPSIDELEFT);
                break;
            default:
                break;
        }
    }

    getOneRandomState(pet: Pet): string {
        let randomStateIndex;

        do {
            randomStateIndex = Phaser.Math.Between(
                0,
                pet.availableStates.length - 1
            );
        } while (
            this.FORBIDDEN_RAND_STATE.includes(
                pet.availableStates[randomStateIndex]
            )
        );

        return pet.availableStates[randomStateIndex];
    }

    getOneRandomStateByPet(pet: Pet): string {
        return this.getOneRandomState(pet);
    }

    playRandomState(pet: Pet): void {
        if (!pet.canPlayRandomState) return;

        this.switchState(pet, this.getOneRandomState(pet));
        pet.canPlayRandomState = false;

        // Rate-limit random transitions so short update intervals do not produce animation flicker.
        setTimeout(() => {
            pet.canPlayRandomState = true;
        }, this.RAND_STATE_DELAY);
    }

    switchStateAfterPetJump(pet: Pet): void {
        if (!pet) return;
        if (
            pet.anims &&
            pet.anims.getName() !== this.configManager.getStateName("jump", pet)
        )
            return;

        if (pet.availableStates.includes("fall")) {
            this.switchState(pet, "fall", {
                repeat: 0,
            });

            // Let a one-shot landing animation finish before normal behavior resumes.
            pet.canPlayRandomState = false;
            pet.on("animationcomplete", () => {
                pet.canPlayRandomState = true;
                this.playRandomState(pet);
            });

            return;
        }
        this.playRandomState(pet);
    }

    getPetGroundPosition(pet: Pet): number {
        return (
            this.physics.world.bounds.height -
            pet.height * Math.abs(pet.scaleY) * pet.originY
        );
    }

    getPetTopPosition(pet: Pet): number {
        return pet.height * Math.abs(pet.scaleY) * pet.originY;
    }

    getPetLeftPosition(pet: Pet): number {
        return pet.width * Math.abs(pet.scaleX) * pet.originX;
    }

    getPetRightPosition(pet: Pet): number {
        return (
            this.physics.world.bounds.width -
            pet.width * Math.abs(pet.scaleX) * pet.originX
        );
    }

    getPetBoundDown(pet: Pet): boolean {
        // Boundary checks use scaled dimensions because users can resize every pet.
        return pet.y >= this.getPetGroundPosition(pet);
    }

    getPetBoundLeft(pet: Pet): boolean {
        return pet.x <= this.getPetLeftPosition(pet);
    }

    getPetBoundRight(pet: Pet): boolean {
        return pet.x >= this.getPetRightPosition(pet);
    }

    getPetBoundTop(pet: Pet): boolean {
        return pet.y <= this.getPetTopPosition(pet);
    }

    updatePetAboveTaskbar(): void {
        if (this.allowPetAboveTaskbar) {
            // availHeight excludes the taskbar, which becomes the overlay's effective floor.
            const taskbarHeight =
                window.screen.height - window.screen.availHeight;

            this.physics.world.setBounds(
                0,
                0,
                window.screen.width,
                window.screen.height - taskbarHeight
            );
            return;
        }

        this.physics.world.setBounds(
            0,
            0,
            window.screen.width,
            window.screen.height
        );
    }

    petJumpOrPlayRandomState(pet: Pet): void {
        if (!pet) return;

        if (pet.availableStates.includes("jump")) {
            this.switchState(pet, "jump");
            return;
        }

        this.switchState(pet, this.getOneRandomState(pet));
    }

    petOnTheGroundPlayRandomState(pet: Pet): void {
        if (!pet) {
            return;
        }

        switch (pet.anims.getName()) {
            case this.configManager.getStateName("climb", pet):
                return;
            case this.configManager.getStateName("crawl", pet):
                return;
            case this.configManager.getStateName("drag", pet):
                return;
            case this.configManager.getStateName("jump", pet):
                return;
        }

        const random = Phaser.Math.Between(0, 2000);
        if (
            pet.anims &&
            pet.anims.getName() === this.configManager.getStateName("walk", pet)
        ) {
            // Walking pets occasionally idle, then resume after a short rest.
            if (random >= 0 && random <= 5) {
                this.switchState(pet, "idle");
                setTimeout(() => {
                    if (
                        pet.anims &&
                        pet.anims.getName() !==
                            this.configManager.getStateName("idle", pet)
                    )
                        return;
                    this.switchState(pet, "walk");
                }, Phaser.Math.Between(3000, 6000));
                return;
            }
        } else {
            // Non-walking pets get more chances to transition so they do not stall indefinitely.
            if (random >= 777 && random <= 800) {
                this.playRandomState(pet);
                return;
            }
        }

        if (random >= 888 && random <= 890) {
            // Keep spontaneous turns rare and rate-limited so movement does not jitter.
            if (pet.canRandomFlip) {
                this.toggleFlipXThenUpdateDirection(pet);
                pet.canRandomFlip = false;

                setTimeout(() => {
                    pet.canRandomFlip = true;
                }, this.FLIP_DELAY);
            }
        } else if (random >= 777 && random <= 780) {
            this.playRandomState(pet);
        } else if (random >= 170 && random <= 175) {
            this.switchState(pet, "walk");
        }
    }

    randomJumpIfPetClimbAndCrawl(): void {
        if (this.petClimbAndCrawlIndex.length === 0) return;

        for (const index of this.petClimbAndCrawlIndex) {
            const pet = this.pets[index];
            if (!pet) continue;

            switch (pet.anims.getName()) {
                case this.configManager.getStateName("drag", pet):
                    continue;
                case this.configManager.getStateName("jump", pet):
                    continue;
            }

            const random = Phaser.Math.Between(0, 500);

            if (random === 78) {
                let newPetx = pet.x;
                // Climbers jump away from their wall instead of dropping straight down.
                if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("climb", pet)
                ) {
                    newPetx =
                        pet.scaleX < 0
                            ? Phaser.Math.Between(pet.x, 500)
                            : Phaser.Math.Between(
                                  pet.x,
                                  this.physics.world.bounds.width - 500
                              );
                }

                // Disable Arcade while the tween moves the pet so the two systems do not fight.
                if (pet.body!.enable) pet.body!.enable = false;
                this.switchState(pet, "jump");
                this.tweens.add({
                    targets: pet,
                    x: newPetx,
                    y: this.getPetGroundPosition(pet),
                    duration: 3000,
                    ease: Ease.QuadEaseOut,
                    onComplete: () => {
                        if (!pet.body!.enable) {
                            pet.body!.enable = true;
                            this.switchStateAfterPetJump(pet);
                        }
                    },
                });
                return;
            }

            // Climb and crawl animations occasionally pause so wall movement feels less mechanical.
            if (random >= 0 && random <= 5) {
                if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("climb", pet)
                ) {
                    pet.anims.pause();
                    this.updateDirection(pet, Direction.UNKNOWN);
                    // @ts-ignore
                    pet.body!.allowGravity = false;
                    setTimeout(() => {
                        if (pet.anims && !pet.anims.isPlaying) {
                            pet.anims.resume();
                            this.updateDirection(pet, Direction.UP);
                        }
                    }, Phaser.Math.Between(3000, 6000));
                    return;
                } else if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("crawl", pet)
                ) {
                    pet.anims.pause();
                    this.updateDirection(pet, Direction.UNKNOWN);
                    // @ts-ignore
                    pet.body!.allowGravity = false;
                    setTimeout(() => {
                        if (pet.anims && !pet.anims.isPlaying) {
                            pet.anims.resume();
                            this.updateDirection(
                                pet,
                                pet.scaleX < 0
                                    ? Direction.UPSIDELEFT
                                    : Direction.UPSIDERIGHT
                            );
                        }
                    }, Phaser.Math.Between(3000, 6000));
                    return;
                }
            }
        }
    }

    petBeyondScreenSwitchClimb(pet: Pet, worldBounding: IWorldBounding): void {
        if (!pet) return;

        // Climb and crawl already own their boundary behavior until another transition occurs.
        switch (pet.anims.getName()) {
            case this.configManager.getStateName("climb", pet):
                return;
            case this.configManager.getStateName("crawl", pet):
                return;
        }

        if (worldBounding.left || worldBounding.right) {
            if (
                pet.availableStates.includes("climb") &&
                this.allowPetClimbing
            ) {
                this.switchState(pet, "climb");

                const lastPetX = pet.x;
                if (worldBounding.left) {
                    // Correct the center-based X position so a dragged pet aligns with the left wall.
                    pet.setPosition(
                        lastPetX - this.getPetLeftPosition(pet),
                        pet.y
                    );
                    this.setPetLookToTheLeft(pet, true);
                } else {
                    pet.setPosition(
                        lastPetX + this.getPetRightPosition(pet),
                        pet.y
                    );
                    this.setPetLookToTheLeft(pet, false);
                }
            } else {
                if (worldBounding.down) {
                    // Grounded pets without climbing turn back into the visible world.
                    this.toggleFlipXThenUpdateDirection(pet);
                } else {
                    // Airborne pets without climbing fall back to a supported transition.
                    this.petJumpOrPlayRandomState(pet);
                }
            }
        } else {
            if (worldBounding.down) {
                // A pet released safely on the ground can resume ordinary behavior.
                if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("drag", pet)
                ) {
                    this.switchState(pet, this.getOneRandomState(pet));
                }
            } else {
                // A pet released in open air needs a supported transition back to the ground.
                this.petJumpOrPlayRandomState(pet);
            }
        }
    }
}
