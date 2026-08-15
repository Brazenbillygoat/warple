export const PROFILE_SCHEMA_VERSION = 3 as const;

export const ENGINE_ROLES = [
    "stand",
    "walk",
    "sit",
    "greet",
    "crawl",
    "climb",
    "jump",
    "fall",
    "drag",
    "special",
    "idle",
] as const;

export const ORDINARY_ROLES = ["stand", "sit", "walk", "greet", "idle", "special"] as const;

export const OPTIONAL_ANIMATION_ROLES = [
    "sit-down",
    "stand-up",
    "crawl-hold",
    "climb-hold",
] as const;

export type EngineRole = (typeof ENGINE_ROLES)[number];
export type OrdinaryRole = (typeof ORDINARY_ROLES)[number];
export type OptionalAnimationRole = (typeof OPTIONAL_ANIMATION_ROLES)[number];

export interface AnimationDefinition {
    readonly row: number;
    readonly frames: number;
}

export interface FrameGeometry {
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly columns: number;
    readonly rows: number;
}

export interface CompanionBehavior {
    readonly scale: number;
    readonly animationFrameRate: number;
    readonly gravity: {
        readonly x: number;
        readonly y: number;
    };
    readonly movement: {
        readonly speed: number;
        readonly acceleration: number;
    };
    readonly ordinaryTransitions: {
        readonly cooldownMs: number;
        readonly weights: Readonly<Record<OrdinaryRole, number>>;
    };
    readonly flip: {
        readonly enabled: boolean;
        readonly cooldownMs: number;
        readonly sampleMax: number;
        readonly triggerMin: number;
        readonly triggerMax: number;
    };
    readonly dragging: {
        readonly enabled: boolean;
        readonly throwVelocityMultiplier: number;
        readonly maxThrowSpeed: number;
    };
    readonly climbing: {
        readonly enabled: boolean;
        readonly randomJumpSampleMax: number;
        readonly randomJumpTrigger: number;
        readonly jumpDurationMs: number;
        readonly pauseSampleMax: number;
        readonly pauseTriggerMax: number;
        readonly pauseMinMs: number;
        readonly pauseMaxMs: number;
    };
    readonly supportedTransitions: {
        readonly initialDrop: boolean;
        readonly jumpToFall: boolean;
        readonly wallToClimb: boolean;
        readonly climbToCrawl: boolean;
        readonly crawlEdgeToJump: boolean;
        readonly dragToThrow: boolean;
    };
}

export interface CompanionProfile {
    readonly schemaVersion: typeof PROFILE_SCHEMA_VERSION;
    readonly id: string;
    readonly displayName: string;
    readonly attribution: {
        readonly sourceUrl: string;
    };
    readonly artworkId: string;
    readonly frame: FrameGeometry;
    readonly animations: Readonly<Record<string, AnimationDefinition>>;
    readonly roles: Readonly<Record<EngineRole, string>>;
    readonly optionalAnimationRoles?: Readonly<Partial<Record<OptionalAnimationRole, string>>>;
    readonly behavior: CompanionBehavior;
}

export interface BuiltInArtwork {
    readonly id: string;
    readonly src: string;
    readonly width: number;
    readonly height: number;
}

export interface ValidatedCompanionProfile extends CompanionProfile {
    readonly artwork: BuiltInArtwork;
}

export interface ProfileCatalogEntry {
    readonly id: string;
    readonly displayName: string;
}
