import { error, info } from "@tauri-apps/plugin-log";
import {
    ORDINARY_ROLES,
    type EngineRole,
    type OrdinaryRole,
    type OptionalAnimationRole,
    type ValidatedCompanionProfile,
} from "../profiles/types";
import { selectWeightedOrdinaryRole } from "../profiles/weightedState";
import {
    beginSurfaceHold,
    cancelTransition,
    completeSitDown,
    completeStandUp,
    enterSit,
    initialCompanionTransitionState,
    initialSurfaceHoldState,
    invalidateSurfaceHold,
    isSitTransitionActive,
    leaveSit,
    resumeSurfaceHold,
    type CompanionTransitionIntention,
    type CompanionTransitionState,
    type SurfaceHoldState,
    type TransitionInterruption,
} from "../runtime/animationTransitions";
import {
    cancelCursorAwareness,
    completeCursorGreeting,
    initialCursorAwarenessState,
    updateCursorAwareness,
    type CursorAwarenessIntention,
    type CursorAwarenessState,
    type HorizontalDirection,
} from "../runtime/cursorAwareness";
import type {
    DesktopEnvironmentSnapshot,
    ForegroundWindowCandidate,
} from "../runtime/desktopEnvironment";
import type { OverlayGeometry, Rectangle } from "../runtime/geometry";
import {
    cancelIconAwareness,
    initialIconAwarenessState,
    updateIconAwareness,
    type IconAwarenessIntention,
    type IconAwarenessState,
} from "../runtime/iconAwareness";
import {
    aggregateCollisionContacts,
    clampBodyCenterToRectangle,
    filterCollisionSamplesByOtherBody,
    finiteVectorOrZero,
    matterForceForSemanticAcceleration,
    matterVelocityToPixelsPerSecond,
    mergeCollisionSamplesForPolicy,
    pixelsPerSecondToMatterVelocity,
    pixelsPerSecondVectorToMatterVelocity,
    selectContactTransition,
    shouldEnableOneWayPlatformCollision,
    suppressContactDirection,
    type AggregatedContacts,
    type CollisionSample,
    type ContactDirection,
    type MechanicalState,
    type Vector,
} from "../runtime/matterPolicy";
import { calculateReleaseVelocity } from "../runtime/releaseVelocity";
import {
    initialWindowPlatformState,
    updateWindowPlatform,
    type WindowPlatformState,
} from "../runtime/windowPlatform";
import { Direction, Ease } from "../types/IPet";
import { DesktopEnvironmentManager } from "./desktopEnvironmentManager";
import { ConfigManager, InputManager } from "./manager";

const RUNTIME_UPDATE_INTERVAL_MS = 1000 / 9;
const WALL_THICKNESS = 40;
const SURFACE_GRIP_SPEED = 6;
const BOUNDS_EPSILON = 0.5;
const INITIAL_CEILING_GAP = 1;

const CATEGORY = Object.freeze({
    companion: 0x0001,
    surface: 0x0002,
});

type SurfaceRole = "floor" | "ceiling" | "wall" | "platform";
type SurfaceEdge = "top" | "bottom" | "left" | "right";

interface SurfaceDefinition {
    readonly id: string;
    readonly role: SurfaceRole;
    readonly climbableEdges: readonly SurfaceEdge[];
}

interface MatterCollisionEvent {
    readonly pairs: readonly Phaser.Types.Physics.Matter.MatterCollisionPair[];
}

type Pet = Phaser.Physics.Matter.Sprite & {
    readonly body: MatterJS.BodyType;
    direction: Direction;
    role: EngineRole;
    canRandomFlip: boolean;
};

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
    private desktopEnvironmentManager!: DesktopEnvironmentManager;
    private pet: Pet | undefined;
    private state: MechanicalState = "airborne";
    private climbSide: "left" | "right" | undefined;
    private crawlEntrySide: "left" | "right" | undefined;
    private readonly activeContactSamples = new Map<string, CollisionSample>();
    private readonly pendingImpactSamples = new Map<string, CollisionSample>();
    private readonly surfacesByBodyId = new Map<number, SurfaceDefinition>();
    private frameElapsedMs = 0;
    private nextOrdinaryTransitionAt = 0;
    private cursorAwarenessState: CursorAwarenessState = initialCursorAwarenessState();
    private iconAwarenessState: IconAwarenessState = initialIconAwarenessState();
    private windowPlatformState: WindowPlatformState = initialWindowPlatformState();
    private cursorGreetingCompletion: (() => void) | undefined;
    private windowPlatformBody: MatterJS.BodyType | undefined;
    private windowPlatformBounds: Rectangle | undefined;
    private supportedSurfaceBodyId: number | undefined;
    private startupFailed = false;
    private surfaceJumpInProgress = false;
    private surfaceJumpTween: Phaser.Tweens.Tween | undefined;
    private transitionState: CompanionTransitionState = initialCompanionTransitionState();
    private surfaceHoldState: SurfaceHoldState = initialSurfaceHoldState();
    private sitTransitionCompletion: (() => void) | undefined;

    constructor() {
        super({ key: "Pets" });
    }

    preload(): void {
        const registry = this.readRegistry();
        this.profile = registry.profile;
        this.geometry = registry.geometry;
        this.configManager = new ConfigManager(this.profile);
        this.inputManager = new InputManager(this.geometry);
        this.desktopEnvironmentManager = new DesktopEnvironmentManager(this.geometry);
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
            this.createWorkAreaSurfaces();
            this.pet = this.createCompanion();
            this.registerCollisionBehavior();
            this.registerDragBehavior();
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

        const contacts = this.getPolicySurfaceContacts();
        this.pendingImpactSamples.clear();
        this.applyContactPolicy(contacts);

        this.frameElapsedMs += delta;
        if (this.frameElapsedMs < RUNTIME_UPDATE_INTERVAL_MS) return;
        this.frameElapsedMs = 0;

        this.inputManager.checkIsMouseOverPet();
        this.desktopEnvironmentManager.poll(this.time.now);
        const desktopSnapshot = this.desktopEnvironmentManager.getLatestSnapshot(this.time.now);
        this.updateWindowPlatformBehavior(pet, desktopSnapshot?.foregroundWindow);
        const cursorAwarenessOwnsBehavior = this.updateCursorAwarenessBehavior(pet);
        const iconAwarenessOwnsBehavior = this.updateIconAwarenessBehavior(
            pet,
            desktopSnapshot,
            cursorAwarenessOwnsBehavior,
        );
        if (!cursorAwarenessOwnsBehavior && !iconAwarenessOwnsBehavior) {
            this.updateOrdinaryBehavior(pet);
        }
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

    private createWorkAreaSurfaces(): void {
        const { x, y, width, height } = this.geometry.workArea;
        const walls = [
            {
                definition: {
                    id: "work-area-floor",
                    role: "floor",
                    climbableEdges: [] as const,
                },
                body: this.matter.add.rectangle(
                    x + width / 2,
                    y + height + WALL_THICKNESS / 2,
                    width + WALL_THICKNESS * 2,
                    WALL_THICKNESS,
                    this.surfaceOptions("work-area-floor"),
                ),
            },
            {
                definition: {
                    id: "work-area-ceiling",
                    role: "ceiling",
                    climbableEdges: [] as const,
                },
                body: this.matter.add.rectangle(
                    x + width / 2,
                    y - WALL_THICKNESS / 2,
                    width + WALL_THICKNESS * 2,
                    WALL_THICKNESS,
                    this.surfaceOptions("work-area-ceiling"),
                ),
            },
            {
                definition: {
                    id: "work-area-left-wall",
                    role: "wall",
                    climbableEdges: ["right"] as const,
                },
                body: this.matter.add.rectangle(
                    x - WALL_THICKNESS / 2,
                    y + height / 2,
                    WALL_THICKNESS,
                    height + WALL_THICKNESS * 2,
                    this.surfaceOptions("work-area-left-wall"),
                ),
            },
            {
                definition: {
                    id: "work-area-right-wall",
                    role: "wall",
                    climbableEdges: ["left"] as const,
                },
                body: this.matter.add.rectangle(
                    x + width + WALL_THICKNESS / 2,
                    y + height / 2,
                    WALL_THICKNESS,
                    height + WALL_THICKNESS * 2,
                    this.surfaceOptions("work-area-right-wall"),
                ),
            },
        ] satisfies readonly { definition: SurfaceDefinition; body: MatterJS.BodyType }[];

        for (const { definition, body } of walls) {
            this.surfacesByBodyId.set(body.id, definition);
        }
    }

    private surfaceOptions(label: string): Phaser.Types.Physics.Matter.MatterBodyConfig {
        return {
            isStatic: true,
            label,
            friction: 0.2,
            slop: 0,
            collisionFilter: {
                category: CATEGORY.surface,
                mask: CATEGORY.companion,
            },
        };
    }

    private updateWindowPlatformBehavior(
        pet: Pet,
        candidate: ForegroundWindowCandidate | undefined,
    ): void {
        const result = updateWindowPlatform(this.windowPlatformState, {
            nowMs: this.time.now,
            candidate,
            workArea: this.geometry.workArea,
            companionBounds: this.getBodyRectangle(pet.body),
        });
        this.windowPlatformState = result.state;
        if (result.intention.type === "remove") {
            this.removeWindowPlatform();
        } else if (result.intention.type === "add") {
            this.addWindowPlatform(result.intention.platform, result.intention.candidateId);
        }
    }

    private addWindowPlatform(bounds: Rectangle, candidateId: string): void {
        if (this.windowPlatformBody) return;
        const label = `window-platform-${candidateId}`;
        const body = this.matter.add.rectangle(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
            bounds.width,
            bounds.height,
            {
                ...this.surfaceOptions(label),
                collisionFilter: {
                    category: CATEGORY.surface,
                    mask: 0,
                },
            },
        );
        this.surfacesByBodyId.set(body.id, {
            id: label,
            role: "platform",
            climbableEdges: [],
        });
        this.windowPlatformBody = body;
        this.windowPlatformBounds = Object.freeze({ ...bounds });
    }

    private removeWindowPlatform(): void {
        const platform = this.windowPlatformBody;
        if (!platform) return;
        const wasSupporting = this.supportedSurfaceBodyId === platform.id;
        this.clearContactsForBody(platform.id);
        this.surfacesByBodyId.delete(platform.id);
        this.matter.world.remove(platform);
        this.windowPlatformBody = undefined;
        this.windowPlatformBounds = undefined;
        if (wasSupporting && this.pet) {
            const velocity = matterVelocityToPixelsPerSecond(this.pet.body.velocity);
            this.beginAirborne(finiteVectorOrZero(velocity));
        }
    }

    private updateWindowPlatformCollision(pet: Pet): void {
        const platform = this.windowPlatformBody;
        const platformBounds = this.windowPlatformBounds;
        if (!platform || !platformBounds) return;
        const enabled = shouldEnableOneWayPlatformCollision({
            companionBounds: this.getBodyRectangle(pet.body),
            platform: platformBounds,
            verticalVelocity: matterVelocityToPixelsPerSecond(pet.body.velocity).y,
            currentlySupported: this.supportedSurfaceBodyId === platform.id,
        });
        platform.collisionFilter.mask = enabled ? CATEGORY.companion : 0;
    }

    private createCompanion(): Pet {
        const bounds = this.geometry.workArea;
        const halfWidth = (this.profile.frame.frameWidth * this.profile.behavior.scale) / 2;
        const halfHeight = (this.profile.frame.frameHeight * this.profile.behavior.scale) / 2;
        const minX = Math.ceil(bounds.x + halfWidth);
        const maxX = Math.floor(bounds.x + bounds.width - halfWidth);
        const startX = Phaser.Math.Between(minX, Math.max(minX, maxX));
        // Start just clear of the Matter ceiling pair so the configured initial
        // drop cannot be misclassified as an impact while moving away from it.
        const startY = bounds.y + halfHeight + INITIAL_CEILING_GAP;
        const pet = this.matter.add
            .sprite(startX, startY, this.profile.id, 0, {
                label: `companion-${this.profile.id}`,
                friction: 0.05,
                frictionStatic: 0,
                frictionAir: 0,
                restitution: 0,
                slop: 0,
                collisionFilter: {
                    category: CATEGORY.companion,
                    mask: CATEGORY.surface,
                },
            })
            .setScale(this.profile.behavior.scale)
            .setFixedRotation()
            .setInteractive({
                draggable: this.profile.behavior.dragging.enabled,
            }) as Pet;

        if (this.profile.behavior.dragging.enabled) this.input.setDraggable(pet);
        pet.direction = Direction.UNKNOWN;
        pet.role = "stand";
        pet.canRandomFlip = true;
        return pet;
    }

    private registerCollisionBehavior(): void {
        this.matter.world.on("collisionstart", (event: MatterCollisionEvent) => {
            for (const pair of event.pairs) this.updateActiveContact(pair, true);
        });
        this.matter.world.on("collisionactive", (event: MatterCollisionEvent) => {
            for (const pair of event.pairs) this.updateActiveContact(pair);
        });
        this.matter.world.on("collisionend", (event: MatterCollisionEvent) => {
            for (const pair of event.pairs) this.activeContactSamples.delete(pair.id);
        });
        this.matter.world.on("beforeupdate", () => this.beforePhysicsStep());
    }

    private updateActiveContact(
        pair: Phaser.Types.Physics.Matter.MatterCollisionPair,
        latchImpact = false,
    ): void {
        const pet = this.pet;
        if (!pet) return;
        const bodyA = this.rootBody(pair.bodyA);
        const bodyB = this.rootBody(pair.bodyB);
        if (bodyA.id !== pet.body.id && bodyB.id !== pet.body.id) return;

        const sample: CollisionSample = {
            pairId: pair.id,
            bodyAId: bodyA.id,
            bodyBId: bodyB.id,
            bodyALabel: bodyA.label,
            bodyBLabel: bodyB.label,
            normal: finiteVectorOrZero(pair.collision.normal),
        };
        this.activeContactSamples.set(pair.id, sample);
        if (latchImpact) this.pendingImpactSamples.set(pair.id, sample);
    }

    private rootBody(body: MatterJS.BodyType): MatterJS.BodyType {
        return body.parent && body.parent !== body ? body.parent : body;
    }

    private getPolicySurfaceContacts(): AggregatedContacts {
        const pet = this.pet;
        if (!pet) return this.emptyContacts();
        const contactSamples = mergeCollisionSamplesForPolicy(
            this.activeContactSamples.values(),
            this.pendingImpactSamples.values(),
        );
        const samples = filterCollisionSamplesByOtherBody(
            contactSamples,
            pet.body.id,
            this.surfacesByBodyId,
        );
        return aggregateCollisionContacts(samples, pet.body.id);
    }

    private emptyContacts(): AggregatedContacts {
        return { up: false, down: false, left: false, right: false, normalized: [] };
    }

    private applyContactPolicy(contacts: AggregatedContacts): void {
        if (this.surfaceJumpInProgress || this.releaseFromMissingSurface(contacts)) return;
        if (this.state === "grounded" && contacts.down) {
            this.supportedSurfaceBodyId = this.supportingSurfaceBodyId(contacts);
        }
        const transitionContacts = this.withCrawlEntryContactSuppressed(contacts);
        const transitions = this.profile.behavior.supportedTransitions;
        const action = selectContactTransition(this.state, transitionContacts, {
            crawlEdgeDeparture: transitions.crawlEdgeToJump,
            ceilingToCrawl: this.profile.behavior.climbing.enabled && transitions.climbToCrawl,
        });

        switch (action) {
            case "crawl-edge-departure":
                this.departFromCrawl(transitionContacts);
                break;
            case "ceiling-crawl":
                this.beginCeilingCrawl(contacts);
                break;
            case "ceiling-fall":
                this.beginAirborne({ x: 0, y: this.profile.behavior.movement.speed });
                break;
            case "landing":
                this.finishLanding(contacts);
                break;
            case "side":
                this.handleSideContact(contacts);
                break;
        }
    }

    private withCrawlEntryContactSuppressed(contacts: AggregatedContacts): AggregatedContacts {
        const entrySide = this.crawlEntrySide;
        if (!entrySide) return contacts;
        if (!contacts[entrySide]) {
            this.crawlEntrySide = undefined;
            return contacts;
        }
        return suppressContactDirection(contacts, entrySide);
    }

    private releaseFromMissingSurface(contacts: AggregatedContacts): boolean {
        const supportMissing =
            (this.state === "grounded" && !contacts.down) ||
            (this.state === "climbing" && !contacts.left && !contacts.right) ||
            (this.state === "crawling" && !contacts.up);
        if (!supportMissing || !this.pet) return false;

        this.beginAirborne(matterVelocityToPixelsPerSecond(this.pet.body.velocity));
        return true;
    }

    private supportingSurfaceBodyId(contacts: AggregatedContacts): number | undefined {
        return contacts.normalized.find((contact) => contact.directions.includes("down"))
            ?.otherBodyId;
    }

    private beforePhysicsStep(): void {
        const pet = this.pet;
        if (!pet) return;
        const body = pet.body;
        const speed = this.profile.behavior.movement.speed;

        this.updateWindowPlatformCollision(pet);

        if (this.surfaceJumpInProgress) {
            pet.setIgnoreGravity(true);
            this.matter.body.setVelocity(body, { x: 0, y: 0 });
            return;
        }

        switch (this.state) {
            case "grounded": {
                pet.setIgnoreGravity(false);
                const horizontalSpeed =
                    pet.direction === Direction.LEFT
                        ? -speed
                        : pet.direction === Direction.RIGHT
                          ? speed
                          : 0;
                this.matter.body.setVelocity(body, {
                    x: pixelsPerSecondToMatterVelocity(horizontalSpeed),
                    y: body.velocity.y,
                });
                break;
            }
            case "airborne":
                pet.setIgnoreGravity(false);
                this.matter.body.applyForce(
                    body,
                    body.position,
                    matterForceForSemanticAcceleration(
                        { x: 0, y: this.profile.behavior.movement.acceleration },
                        body.mass,
                    ),
                );
                break;
            case "climbing":
                pet.setIgnoreGravity(true);
                this.matter.body.setVelocity(
                    body,
                    pixelsPerSecondVectorToMatterVelocity({
                        x:
                            this.climbSide === "left"
                                ? -SURFACE_GRIP_SPEED
                                : this.climbSide === "right"
                                  ? SURFACE_GRIP_SPEED
                                  : 0,
                        y: pet.direction === Direction.UP ? -speed : 0,
                    }),
                );
                break;
            case "crawling":
                pet.setIgnoreGravity(true);
                this.matter.body.setVelocity(
                    body,
                    pixelsPerSecondVectorToMatterVelocity({
                        x:
                            pet.direction === Direction.UPSIDELEFT
                                ? -speed
                                : pet.direction === Direction.UPSIDERIGHT
                                  ? speed
                                  : 0,
                        y: -SURFACE_GRIP_SPEED,
                    }),
                );
                break;
            case "dragged":
                pet.setIgnoreGravity(true);
                break;
        }
    }

    private beginCeilingCrawl(contacts: AggregatedContacts): void {
        const pet = this.pet;
        if (!pet || this.state === "crawling") return;
        const entrySide = contacts.left ? "left" : contacts.right ? "right" : undefined;
        if (entrySide) {
            this.crawlEntrySide = entrySide;
            this.setPetLookToTheLeft(pet, entrySide === "right");
        } else {
            const velocity = matterVelocityToPixelsPerSecond(pet.body.velocity);
            if (Math.abs(velocity.x) > 1) this.setPetLookToTheLeft(pet, velocity.x < 0);
        }
        this.setMechanicalState("crawling");
        this.switchRole(pet, "crawl");
    }

    private departFromCrawl(contacts: AggregatedContacts): void {
        const horizontal = contacts.right
            ? -this.profile.behavior.movement.speed
            : this.profile.behavior.movement.speed;
        this.beginAirborne({ x: horizontal, y: this.profile.behavior.movement.speed });
    }

    private finishLanding(contacts?: AggregatedContacts): void {
        const pet = this.pet;
        if (!pet || this.state === "grounded") return;
        this.matter.body.setVelocity(pet.body, { x: 0, y: 0 });
        this.supportedSurfaceBodyId = contacts
            ? this.supportingSurfaceBodyId(contacts)
            : undefined;
        this.setMechanicalState("grounded");

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

    private handleSideContact(contacts: AggregatedContacts): void {
        const pet = this.pet;
        if (
            !pet ||
            !this.profile.behavior.climbing.enabled ||
            !this.profile.behavior.supportedTransitions.wallToClimb ||
            !this.hasClimbableSide(contacts)
        ) {
            return;
        }

        this.climbSide = contacts.left ? "left" : contacts.right ? "right" : undefined;
        if (!this.climbSide) return;
        this.setPetLookToTheLeft(pet, this.climbSide === "left");
        this.setMechanicalState("climbing");
        this.switchRole(pet, "climb");
    }

    private hasClimbableSide(contacts: AggregatedContacts): boolean {
        return contacts.normalized.some((contact) => {
            const surface = this.surfacesByBodyId.get(contact.otherBodyId);
            if (!surface) return false;
            return contact.directions.some((direction) => {
                const edge = this.surfaceEdgeForContact(direction);
                return edge ? surface.climbableEdges.includes(edge) : false;
            });
        });
    }

    private surfaceEdgeForContact(direction: ContactDirection): SurfaceEdge | undefined {
        const edges: Partial<Record<ContactDirection, SurfaceEdge>> = {
            left: "right",
            right: "left",
            up: "bottom",
            down: "top",
        };
        return edges[direction];
    }

    private setMechanicalState(state: MechanicalState): void {
        this.state = state;
        if (state !== "grounded") {
            this.supportedSurfaceBodyId = undefined;
            this.cancelActiveCursorAwareness();
            this.cancelActiveIconAwareness();
            this.cancelSitTransition(state);
        }
        if (state !== "climbing") this.climbSide = undefined;
        if (state !== "crawling") this.crawlEntrySide = undefined;
        this.surfaceHoldState = invalidateSurfaceHold(this.surfaceHoldState);
    }

    private startInitialBehavior(): void {
        const pet = this.pet!;
        if (this.profile.behavior.supportedTransitions.initialDrop) {
            this.beginAirborne({ x: 0, y: this.profile.behavior.movement.speed });
        } else {
            this.setMechanicalState("grounded");
            this.playOrdinaryState(pet);
        }
    }

    private beginAirborne(semanticVelocity: Vector): void {
        const pet = this.pet;
        if (!pet) return;
        pet.setIgnoreGravity(false);
        this.matter.body.setVelocity(
            pet.body,
            pixelsPerSecondVectorToMatterVelocity(semanticVelocity),
        );
        this.setMechanicalState("airborne");
        this.switchRole(pet, "jump");
    }

    private playOrdinaryState(pet: Pet): void {
        const role = selectWeightedOrdinaryRole(
            this.profile.behavior.ordinaryTransitions.weights,
            Math.random(),
        );
        this.setMechanicalState("grounded");
        this.requestGroundedRole(pet, role);
        this.nextOrdinaryTransitionAt =
            this.time.now + this.profile.behavior.ordinaryTransitions.cooldownMs;
    }

    private requestGroundedRole(pet: Pet, role: OrdinaryRole): void {
        if (role === "sit") {
            const result = enterSit(
                this.transitionState,
                this.configManager.getOptionalAnimationKey("sit-down") !== undefined,
            );
            this.transitionState = result.state;
            this.executeTransitionIntention(pet, result.intention);
            return;
        }
        const result = leaveSit(
            this.transitionState,
            role,
            this.configManager.getOptionalAnimationKey("stand-up") !== undefined,
        );
        this.transitionState = result.state;
        this.executeTransitionIntention(pet, result.intention);
    }

    private cancelSitTransition(interruption: TransitionInterruption): void {
        const pet = this.pet;
        if (pet) this.clearSitTransitionCompletion(pet);
        this.transitionState = cancelTransition(this.transitionState, interruption).state;
    }

    private clearSitTransitionCompletion(pet: Pet): void {
        if (!this.sitTransitionCompletion) return;
        pet.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.sitTransitionCompletion);
        this.sitTransitionCompletion = undefined;
    }

    private executeTransitionIntention(
        pet: Pet,
        intention: CompanionTransitionIntention,
    ): void {
        switch (intention.type) {
            case "none":
                return;
            case "play-role":
                this.clearSitTransitionCompletion(pet);
                this.switchRole(pet, intention.role);
                return;
            case "play-optional-once": {
                this.clearSitTransitionCompletion(pet);
                const key = this.configManager.getOptionalAnimationKey(intention.optionalRole);
                if (!key) return;
                const capturedGeneration = this.transitionState.generation;
                const optionalRole = intention.optionalRole;
                const completion = () => {
                    this.sitTransitionCompletion = undefined;
                    const result =
                        optionalRole === "sit-down"
                            ? completeSitDown(this.transitionState, capturedGeneration)
                            : completeStandUp(this.transitionState, capturedGeneration);
                    this.transitionState = result.state;
                    this.executeTransitionIntention(pet, result.intention);
                };
                this.sitTransitionCompletion = completion;
                pet.anims.play({ key, repeat: 0 });
                if (optionalRole === "sit-down") {
                    pet.role = "sit";
                } else {
                    pet.role = this.transitionState.pendingTarget ?? pet.role;
                }
                this.updateDirection(pet, Direction.UNKNOWN);
                pet.once(Phaser.Animations.Events.ANIMATION_COMPLETE, completion);
                return;
            }
        }
    }

    private updateOrdinaryBehavior(pet: Pet): void {
        if (this.state !== "grounded") return;
        if (!ORDINARY_ROLES.includes(pet.role as (typeof ORDINARY_ROLES)[number])) return;
        if (isSitTransitionActive(this.transitionState)) return;

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

    private updateCursorAwarenessBehavior(pet: Pet): boolean {
        const result = updateCursorAwareness(this.cursorAwarenessState, {
            nowMs: this.time.now,
            eligible:
                this.state === "grounded" &&
                ORDINARY_ROLES.includes(pet.role as (typeof ORDINARY_ROLES)[number]),
            cursor: this.inputManager.getLatestCursorSnapshot(),
            companionCenter: { x: pet.body.position.x, y: pet.body.position.y },
            companionBounds: {
                min: { x: pet.body.bounds.min.x, y: pet.body.bounds.min.y },
                max: { x: pet.body.bounds.max.x, y: pet.body.bounds.max.y },
            },
            workArea: this.geometry.workArea,
        });
        this.cursorAwarenessState = result.state;
        this.executeCursorAwarenessIntention(pet, result.intention);
        return (
            result.state.phase === "notice" ||
            result.state.phase === "approach" ||
            result.state.phase === "greeting"
        );
    }

    private executeCursorAwarenessIntention(
        pet: Pet,
        intention: CursorAwarenessIntention,
    ): void {
        switch (intention.type) {
            case "none":
                break;
            case "observe":
                this.cancelSitTransition("cursor-observe");
                this.matter.body.setVelocity(pet.body, { x: 0, y: pet.body.velocity.y });
                this.switchRole(pet, "stand");
                this.faceCursorDirection(pet, intention.direction);
                break;
            case "approach":
                this.cancelSitTransition("cursor-approach");
                this.switchRole(pet, "walk");
                this.updateDirection(
                    pet,
                    intention.direction === "left" ? Direction.LEFT : Direction.RIGHT,
                );
                break;
            case "greet":
                this.cancelSitTransition("cursor-greet");
                this.matter.body.setVelocity(pet.body, { x: 0, y: pet.body.velocity.y });
                this.faceCursorDirection(pet, intention.direction);
                this.switchRole(pet, "greet", { repeat: 0 });
                this.clearCursorGreetingCompletion(pet);
                this.cursorGreetingCompletion = () => {
                    this.cursorGreetingCompletion = undefined;
                    if (
                        !pet.active ||
                        this.state !== "grounded" ||
                        this.cursorAwarenessState.phase !== "greeting"
                    ) {
                        return;
                    }
                    const completed = completeCursorGreeting(
                        this.cursorAwarenessState,
                        this.time.now,
                    );
                    this.cursorAwarenessState = completed.state;
                    this.executeCursorAwarenessIntention(pet, completed.intention);
                };
                pet.once(
                    Phaser.Animations.Events.ANIMATION_COMPLETE,
                    this.cursorGreetingCompletion,
                );
                break;
            case "disengage":
                this.clearCursorGreetingCompletion(pet);
                this.nextOrdinaryTransitionAt =
                    this.time.now + this.profile.behavior.ordinaryTransitions.cooldownMs;
                if (this.state === "grounded") {
                    this.matter.body.setVelocity(pet.body, { x: 0, y: pet.body.velocity.y });
                    this.requestGroundedRole(pet, "stand");
                }
                break;
        }
    }

    private faceCursorDirection(pet: Pet, direction: HorizontalDirection): void {
        this.setPetLookToTheLeft(pet, direction === "left");
        this.updateDirection(pet, Direction.UNKNOWN);
    }

    private cancelActiveCursorAwareness(): void {
        const result = cancelCursorAwareness(this.cursorAwarenessState, this.time.now);
        this.cursorAwarenessState = result.state;
        if (result.intention.type === "disengage") {
            if (this.pet) this.clearCursorGreetingCompletion(this.pet);
            this.nextOrdinaryTransitionAt =
                this.time.now + this.profile.behavior.ordinaryTransitions.cooldownMs;
        }
    }

    private clearCursorGreetingCompletion(pet: Pet): void {
        if (!this.cursorGreetingCompletion) return;
        pet.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.cursorGreetingCompletion);
        this.cursorGreetingCompletion = undefined;
    }

    private updateIconAwarenessBehavior(
        pet: Pet,
        snapshot: DesktopEnvironmentSnapshot | undefined,
        cursorAwarenessOwnsBehavior: boolean,
    ): boolean {
        const result = updateIconAwareness(this.iconAwarenessState, {
            nowMs: this.time.now,
            available: snapshot !== undefined,
            desktopShellActive: snapshot?.desktopShellActive ?? false,
            groundedEligible:
                this.state === "grounded" &&
                ORDINARY_ROLES.includes(pet.role as (typeof ORDINARY_ROLES)[number]),
            higherPriorityOwned: cursorAwarenessOwnsBehavior,
            icons: snapshot?.desktopItems ?? [],
            companionBounds: this.getBodyRectangle(pet.body),
            workArea: this.geometry.workArea,
        });
        this.iconAwarenessState = result.state;
        if (result.requestDetailsFor) {
            this.desktopEnvironmentManager.requestDetails(result.requestDetailsFor);
        }
        if (!(cursorAwarenessOwnsBehavior && result.intention.type === "disengage")) {
            this.executeIconAwarenessIntention(pet, result.intention);
        }
        return ["notice", "approach", "inspect", "sit"].includes(result.state.phase);
    }

    private executeIconAwarenessIntention(
        pet: Pet,
        intention: IconAwarenessIntention,
    ): void {
        switch (intention.type) {
            case "none":
                break;
            case "observe":
            case "inspect":
                this.matter.body.setVelocity(pet.body, { x: 0, y: pet.body.velocity.y });
                this.faceIconDirection(pet, intention.direction);
                this.requestGroundedRole(pet, "stand");
                break;
            case "approach":
                this.requestGroundedRole(pet, "walk");
                this.updateDirection(
                    pet,
                    intention.direction === "left" ? Direction.LEFT : Direction.RIGHT,
                );
                break;
            case "sit":
                this.matter.body.setVelocity(pet.body, { x: 0, y: pet.body.velocity.y });
                this.faceIconDirection(pet, intention.direction);
                this.requestGroundedRole(pet, "sit");
                break;
            case "disengage":
                this.nextOrdinaryTransitionAt =
                    this.time.now + this.profile.behavior.ordinaryTransitions.cooldownMs;
                if (this.state === "grounded") {
                    this.matter.body.setVelocity(pet.body, { x: 0, y: pet.body.velocity.y });
                    this.requestGroundedRole(pet, "stand");
                }
                break;
        }
    }

    private faceIconDirection(pet: Pet, direction: "left" | "right"): void {
        this.setPetLookToTheLeft(pet, direction === "left");
        this.updateDirection(pet, Direction.UNKNOWN);
    }

    private cancelActiveIconAwareness(): void {
        const result = cancelIconAwareness(this.iconAwarenessState, this.time.now);
        this.iconAwarenessState = result.state;
        if (result.intention.type === "disengage") {
            this.nextOrdinaryTransitionAt =
                this.time.now + this.profile.behavior.ordinaryTransitions.cooldownMs;
        }
    }

    private updateClimbAndCrawlBehavior(pet: Pet): void {
        if (this.state !== "climbing" && this.state !== "crawling") return;
        const climbing = this.profile.behavior.climbing;
        const jumpSample = Phaser.Math.Between(0, climbing.randomJumpSampleMax);
        if (jumpSample === climbing.randomJumpTrigger) {
            this.jumpFromSurface(pet);
            return;
        }
        if (this.surfaceHoldState.active) return;

        const pauseSample = Phaser.Math.Between(0, climbing.pauseSampleMax);
        if (pauseSample > climbing.pauseTriggerMax || !pet.anims.isPlaying) return;
        const pausedState = this.state;
        this.updateDirection(pet, Direction.UNKNOWN);
        pet.setIgnoreGravity(true);

        const holdRole: OptionalAnimationRole | undefined =
            pausedState === "crawling" ? "crawl-hold" : "climb-hold";
        const holdKey = holdRole ? this.configManager.getOptionalAnimationKey(holdRole) : undefined;
        if (holdKey) {
            const began = beginSurfaceHold(this.surfaceHoldState, pausedState);
            this.surfaceHoldState = began.state;
            const capturedGeneration = began.generation;
            pet.anims.play({ key: holdKey, repeat: -1 });
            window.setTimeout(() => {
                if (!pet.active) return;
                const resume = resumeSurfaceHold(this.surfaceHoldState, capturedGeneration, this.state);
                this.surfaceHoldState = resume.state;
                if (!resume.shouldResume) return;
                this.resumeSurfaceAnimation(pet, pausedState);
            }, Phaser.Math.Between(climbing.pauseMinMs, climbing.pauseMaxMs));
        } else {
            pet.anims.pause();
            window.setTimeout(() => {
                if (!pet.active || this.state !== pausedState || pet.anims.isPlaying) return;
                pet.anims.resume();
                this.resumeSurfaceAnimation(pet, pausedState);
            }, Phaser.Math.Between(climbing.pauseMinMs, climbing.pauseMaxMs));
        }
    }

    private resumeSurfaceAnimation(pet: Pet, pausedState: MechanicalState): void {
        this.switchRole(pet, pausedState === "climbing" ? "climb" : "crawl");
        this.updateDirection(
            pet,
            pausedState === "climbing"
                ? Direction.UP
                : pet.flipX
                  ? Direction.UPSIDELEFT
                  : Direction.UPSIDERIGHT,
        );
    }

    private jumpFromSurface(pet: Pet): void {
        const centers = this.getCenters(pet);
        const targetX =
            this.state === "climbing"
                ? Phaser.Math.Between(Math.ceil(centers.left), Math.floor(centers.right))
                : pet.x;
        const targetY = centers.bottom;
        const tweenPosition = { x: pet.x, y: pet.y };

        this.clearContactsForBody(pet.body.id);
        this.makeBodyStatic(pet.body);
        this.surfaceJumpInProgress = true;
        this.setMechanicalState("airborne");
        this.switchRole(pet, "jump");
        this.surfaceJumpTween = this.tweens.add({
            targets: tweenPosition,
            x: targetX,
            y: targetY,
            duration: this.profile.behavior.climbing.jumpDurationMs,
            ease: Ease.QuadEaseOut,
            onUpdate: () => {
                const position = { x: tweenPosition.x, y: tweenPosition.y };
                this.matter.body.setPosition(pet.body, position);
                pet.setPosition(position.x, position.y);
            },
            onComplete: () => {
                this.surfaceJumpTween = undefined;
                this.surfaceJumpInProgress = false;
                this.restoreDynamicBody(pet.body, { x: targetX, y: targetY });
                this.matter.body.setVelocity(
                    pet.body,
                    pixelsPerSecondVectorToMatterVelocity({
                        x: 0,
                        y: this.profile.behavior.movement.speed,
                    }),
                );
            },
        });
    }

    private registerDragBehavior(): void {
        if (!this.profile.behavior.dragging.enabled) return;

        this.input.on(
            Phaser.Input.Events.DRAG_START,
            (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
                if (gameObject === this.pet) this.beginDrag();
            },
        );
        this.input.on(
            Phaser.Input.Events.DRAG,
            (
                _pointer: Phaser.Input.Pointer,
                gameObject: Phaser.GameObjects.GameObject,
                dragX: number,
                dragY: number,
            ) => {
                const pet = this.pet;
                if (!pet || gameObject !== pet) return;
                this.positionDraggedPet(pet, { x: dragX, y: dragY });
                this.setPetLookToTheLeft(pet, dragX <= (pet.input?.dragStartX ?? dragX));
            },
        );
        this.input.on(
            Phaser.Input.Events.DRAG_END,
            (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
                if (gameObject === this.pet) this.releaseDraggedPet(pointer);
            },
        );
    }

    private beginDrag(): void {
        const pet = this.pet;
        if (!pet) return;
        this.surfaceJumpTween?.stop();
        this.surfaceJumpTween = undefined;
        this.surfaceJumpInProgress = false;
        this.clearContactsForBody(pet.body.id);
        this.makeBodyStatic(pet.body);
        this.setMechanicalState("dragged");
        this.switchRole(pet, "drag");
    }

    private makeBodyStatic(body: MatterJS.BodyType): void {
        this.matter.body.setVelocity(body, { x: 0, y: 0 });
        this.matter.body.setAngularVelocity(body, 0);
        this.matter.body.setStatic(body, true);
    }

    private positionDraggedPet(pet: Pet, requestedPosition: Vector): void {
        const position = clampBodyCenterToRectangle(
            requestedPosition,
            this.getBodyHalfExtents(pet.body),
            this.geometry.workArea,
        );
        this.matter.body.setPosition(pet.body, position);
        this.matter.body.setVelocity(pet.body, { x: 0, y: 0 });
        this.matter.body.setAngularVelocity(pet.body, 0);
        pet.setPosition(position.x, position.y);
    }

    private releaseDraggedPet(pointer: Phaser.Input.Pointer): void {
        const pet = this.pet;
        if (!pet) return;
        const position = this.clampedBodyPosition(pet.body);
        this.restoreDynamicBody(pet.body, position);

        if (!this.profile.behavior.supportedTransitions.dragToThrow) {
            this.recoverAfterInteraction(pet);
            return;
        }

        const dragging = this.profile.behavior.dragging;
        const semanticVelocity = calculateReleaseVelocity(
            pointer.velocity,
            dragging.throwVelocityMultiplier,
            dragging.maxThrowSpeed,
        );
        this.matter.body.setVelocity(
            pet.body,
            pixelsPerSecondVectorToMatterVelocity(semanticVelocity, dragging.maxThrowSpeed),
        );
        this.setMechanicalState("airborne");
        this.switchRole(pet, "jump");
    }

    private restoreDynamicBody(body: MatterJS.BodyType, position: Vector): void {
        this.matter.body.setVelocity(body, { x: 0, y: 0 });
        this.matter.body.setAngularVelocity(body, 0);
        this.matter.body.setPosition(body, position);
        this.matter.body.setStatic(body, false);
        this.matter.body.setPosition(body, position);
        this.matter.body.setAngle(body, 0);
        this.matter.body.setInertia(body, Infinity);
    }

    private recoverAfterInteraction(pet: Pet): void {
        const bounds = this.getBounds(pet);
        if (bounds.left || bounds.right) {
            this.handleSideBoundary(pet, bounds.left, bounds.right, bounds.down);
        } else if (bounds.down) {
            this.finishLanding();
        } else {
            this.beginAirborne({ x: 0, y: this.profile.behavior.movement.speed });
        }
    }

    private handleSideBoundary(pet: Pet, left: boolean, right: boolean, down: boolean): void {
        const transitions = this.profile.behavior.supportedTransitions;
        if (
            this.profile.behavior.climbing.enabled &&
            transitions.wallToClimb &&
            (left || right)
        ) {
            this.climbSide = left ? "left" : "right";
            this.setPetLookToTheLeft(pet, left);
            this.setMechanicalState("climbing");
            this.switchRole(pet, "climb");
            return;
        }

        if (down) {
            this.setMechanicalState("grounded");
            this.toggleFlipXThenUpdateDirection(pet);
        } else {
            this.beginAirborne({ x: 0, y: this.profile.behavior.movement.speed });
        }
    }

    private clampedBodyPosition(body: MatterJS.BodyType): Vector {
        return clampBodyCenterToRectangle(
            body.position,
            this.getBodyHalfExtents(body),
            this.geometry.workArea,
        );
    }

    private getBodyHalfExtents(body: MatterJS.BodyType): Vector {
        return {
            x: (body.bounds.max.x - body.bounds.min.x) / 2,
            y: (body.bounds.max.y - body.bounds.min.y) / 2,
        };
    }

    private getBodyRectangle(body: MatterJS.BodyType): Rectangle {
        return {
            x: body.bounds.min.x,
            y: body.bounds.min.y,
            width: body.bounds.max.x - body.bounds.min.x,
            height: body.bounds.max.y - body.bounds.min.y,
        };
    }

    private clearContactsForBody(bodyId: number): void {
        for (const samples of [this.activeContactSamples, this.pendingImpactSamples]) {
            for (const [pairId, sample] of samples) {
                if (sample.bodyAId === bodyId || sample.bodyBId === bodyId) {
                    samples.delete(pairId);
                }
            }
        }
    }

    private switchRole(
        pet: Pet,
        role: EngineRole,
        options: { readonly repeat?: number; readonly delay?: number; readonly repeatDelay?: number } = {},
    ): void {
        try {
            const animationKey = this.configManager.getAnimationKeyForRole(role);
            if (
                options.repeat === undefined &&
                pet.role === role &&
                pet.anims.getName() === animationKey &&
                pet.anims.isPlaying
            ) {
                return;
            }
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
                this.updateDirection(pet, pet.flipX ? Direction.LEFT : Direction.RIGHT);
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
                    pet.flipX ? Direction.UPSIDELEFT : Direction.UPSIDERIGHT,
                );
                break;
            default:
                this.updateDirection(pet, Direction.UNKNOWN);
        }
    }

    private updateDirection(pet: Pet, direction: Direction): void {
        pet.direction = direction;
        switch (direction) {
            case Direction.RIGHT:
                this.setPetLookToTheLeft(pet, false);
                break;
            case Direction.LEFT:
                this.setPetLookToTheLeft(pet, true);
                break;
            case Direction.UPSIDELEFT:
                this.setPetLookToTheLeft(pet, true);
                break;
            case Direction.UPSIDERIGHT:
                this.setPetLookToTheLeft(pet, false);
                break;
        }
    }

    private setPetLookToTheLeft(pet: Pet, left: boolean): void {
        if (pet.flipX !== left) pet.setFlipX(left);
    }

    private toggleFlipX(pet: Pet): void {
        pet.setFlipX(!pet.flipX);
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
        const halfExtents = this.getBodyHalfExtents(pet.body);
        const bounds = this.geometry.workArea;
        return {
            left: bounds.x + halfExtents.x,
            right: bounds.x + bounds.width - halfExtents.x,
            top: bounds.y + halfExtents.y,
            bottom: bounds.y + bounds.height - halfExtents.y,
        };
    }

    private getBounds(pet: Pet): Record<"up" | "down" | "left" | "right", boolean> {
        const bounds = this.geometry.workArea;
        return {
            up: pet.body.bounds.min.y <= bounds.y + BOUNDS_EPSILON,
            down:
                pet.body.bounds.max.y >= bounds.y + bounds.height - BOUNDS_EPSILON,
            left: pet.body.bounds.min.x <= bounds.x + BOUNDS_EPSILON,
            right:
                pet.body.bounds.max.x >= bounds.x + bounds.width - BOUNDS_EPSILON,
        };
    }
}

export function getWorldBounds(geometry: OverlayGeometry): Rectangle {
    return geometry.workArea;
}
