import { BUILT_IN_ARTWORK } from "./artwork";
import {
    ENGINE_ROLES,
    OPTIONAL_ANIMATION_ROLES,
    ORDINARY_ROLES,
    PROFILE_SCHEMA_VERSION,
    type BuiltInArtwork,
    type CompanionProfile,
    type EngineRole,
    type OptionalAnimationRole,
    type OrdinaryRole,
    type ValidatedCompanionProfile,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const PROFILE_KEYS = [
    "schemaVersion",
    "id",
    "displayName",
    "attribution",
    "artworkId",
    "frame",
    "animations",
    "roles",
    "behavior",
] as const;

const LIMITS = Object.freeze({
    identifierLength: 64,
    displayNameLength: 80,
    sourceUrlLength: 2048,
    frameSize: { min: 1, max: 2048 },
    sheetAxis: { min: 1, max: 256 },
    scale: { min: 0.1, max: 4 },
    animationFrameRate: { min: 1, max: 60 },
    gravity: { min: -5000, max: 5000 },
    movement: { min: 0, max: 5000 },
    durationMs: { min: 0, max: 120_000 },
    positiveDurationMs: { min: 1, max: 120_000 },
    weight: { min: 0, max: 10_000 },
    sample: { min: 0, max: 1_000_000 },
    throwVelocityMultiplier: { min: 0, max: 100 },
    throwSpeed: { min: 1, max: 5000 },
});

export const PROFILE_VALIDATION_LIMITS = LIMITS;

function fail(message: string): never {
    throw new Error(`Invalid companion profile: ${message}`);
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): UnknownRecord {
    if (!isRecord(value)) fail(`${path} must be an object`);
    return value;
}

function exactKeys(
    value: UnknownRecord,
    keys: readonly string[],
    path: string,
    optionalKeys: readonly string[] = [],
): void {
    const expected = new Set(keys);
    const optional = new Set(optionalKeys);
    for (const key of Object.keys(value)) {
        if (!expected.has(key) && !optional.has(key)) fail(`${path}.${key} is not supported`);
    }
    for (const key of keys) {
        if (!(key in value)) fail(`${path}.${key} is required`);
    }
}

function stringValue(value: unknown, path: string, maxLength: number): string {
    if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
        fail(`${path} must be a nonempty trimmed string`);
    }
    if (value.length > maxLength) fail(`${path} is too long`);
    return value;
}

function identifier(value: unknown, path: string): string {
    const result = stringValue(value, path, LIMITS.identifierLength);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) {
        fail(`${path} must be a lowercase kebab-case identifier`);
    }
    return result;
}

function numberValue(
    value: unknown,
    path: string,
    limits: { readonly min: number; readonly max: number },
    integer = false,
): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(`${path} must be finite`);
    }
    if (integer && !Number.isInteger(value)) fail(`${path} must be an integer`);
    if (value < limits.min || value > limits.max) fail(`${path} is outside its safe range`);
    return value;
}

function booleanValue(value: unknown, path: string): boolean {
    if (typeof value !== "boolean") fail(`${path} must be a boolean`);
    return value;
}

function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value as UnknownRecord)) deepFreeze(child);
    }
    return value;
}

function validateAttribution(value: unknown): CompanionProfile["attribution"] {
    const attribution = record(value, "attribution");
    exactKeys(attribution, ["sourceUrl"], "attribution");
    const sourceUrl = stringValue(
        attribution.sourceUrl,
        "attribution.sourceUrl",
        LIMITS.sourceUrlLength,
    );
    let parsed: URL;
    try {
        parsed = new URL(sourceUrl);
    } catch {
        fail("attribution.sourceUrl must be a valid URL");
    }
    if (parsed.protocol !== "https:") fail("attribution.sourceUrl must use HTTPS");
    return { sourceUrl };
}

function validateFrame(value: unknown, artwork: BuiltInArtwork): CompanionProfile["frame"] {
    const frame = record(value, "frame");
    exactKeys(frame, ["frameWidth", "frameHeight", "columns", "rows"], "frame");
    const result = {
        frameWidth: numberValue(frame.frameWidth, "frame.frameWidth", LIMITS.frameSize, true),
        frameHeight: numberValue(frame.frameHeight, "frame.frameHeight", LIMITS.frameSize, true),
        columns: numberValue(frame.columns, "frame.columns", LIMITS.sheetAxis, true),
        rows: numberValue(frame.rows, "frame.rows", LIMITS.sheetAxis, true),
    };
    if (result.frameWidth * result.columns !== artwork.width) {
        fail("frame columns do not match the registered artwork width");
    }
    if (result.frameHeight * result.rows !== artwork.height) {
        fail("frame rows do not match the registered artwork height");
    }
    return result;
}

function validateAnimations(
    value: unknown,
    frame: CompanionProfile["frame"],
): CompanionProfile["animations"] {
    const animations = record(value, "animations");
    if (Object.keys(animations).length === 0) fail("animations must not be empty");
    const result: Record<string, { row: number; frames: number }> = {};
    for (const [name, definitionValue] of Object.entries(animations)) {
        identifier(name, `animations.${name}`);
        const definition = record(definitionValue, `animations.${name}`);
        exactKeys(definition, ["row", "frames"], `animations.${name}`);
        const row = numberValue(
            definition.row,
            `animations.${name}.row`,
            { min: 1, max: frame.rows },
            true,
        );
        const frames = numberValue(
            definition.frames,
            `animations.${name}.frames`,
            { min: 1, max: frame.columns },
            true,
        );
        result[name] = { row, frames };
    }
    return result;
}

function validateRoles(
    value: unknown,
    animations: CompanionProfile["animations"],
): CompanionProfile["roles"] {
    const roles = record(value, "roles");
    exactKeys(roles, ENGINE_ROLES, "roles");
    const result = {} as Record<EngineRole, string>;
    for (const role of ENGINE_ROLES) {
        const animationName = identifier(roles[role], `roles.${role}`);
        if (!(animationName in animations)) fail(`roles.${role} references an unknown animation`);
        result[role] = animationName;
    }
    return result;
}

function validateOptionalAnimationRoles(
    value: unknown,
    animations: CompanionProfile["animations"],
): CompanionProfile["optionalAnimationRoles"] {
    if (value === undefined) return undefined;
    const optionalAnimationRoles = record(value, "optionalAnimationRoles");
    for (const key of Object.keys(optionalAnimationRoles)) {
        if (!(OPTIONAL_ANIMATION_ROLES as readonly string[]).includes(key)) {
            fail(`optionalAnimationRoles.${key} is not supported`);
        }
    }
    const result: Partial<Record<OptionalAnimationRole, string>> = {};
    for (const [key, entry] of Object.entries(optionalAnimationRoles)) {
        const animationName = identifier(entry, `optionalAnimationRoles.${key}`);
        if (!(animationName in animations)) {
            fail(`optionalAnimationRoles.${key} references an unknown animation`);
        }
        (result as Record<string, string>)[key] = animationName;
    }
    const hasSitDown = "sit-down" in result;
    const hasStandUp = "stand-up" in result;
    if (hasSitDown !== hasStandUp) {
        fail("optionalAnimationRoles sit-down and stand-up must be present together or absent");
    }
    return Object.keys(result).length === 0 ? undefined : result;
}

function validateWeights(
    value: unknown,
    roles: CompanionProfile["roles"],
    animations: CompanionProfile["animations"],
): Readonly<Record<OrdinaryRole, number>> {
    const weights = record(value, "behavior.ordinaryTransitions.weights");
    exactKeys(weights, ORDINARY_ROLES, "behavior.ordinaryTransitions.weights");
    const result = {} as Record<OrdinaryRole, number>;
    let total = 0;
    for (const role of ORDINARY_ROLES) {
        const weight = numberValue(
            weights[role],
            `behavior.ordinaryTransitions.weights.${role}`,
            LIMITS.weight,
            true,
        );
        if (!(roles[role] in animations)) fail(`ordinary role ${role} has no defined animation`);
        result[role] = weight;
        total += weight;
    }
    if (total !== 100) fail("ordinary transition weights must total 100");
    return result;
}

function validateBehavior(
    value: unknown,
    roles: CompanionProfile["roles"],
    animations: CompanionProfile["animations"],
): CompanionProfile["behavior"] {
    const behavior = record(value, "behavior");
    exactKeys(
        behavior,
        [
            "scale",
            "animationFrameRate",
            "gravity",
            "movement",
            "ordinaryTransitions",
            "flip",
            "dragging",
            "climbing",
            "supportedTransitions",
        ],
        "behavior",
    );

    const gravity = record(behavior.gravity, "behavior.gravity");
    exactKeys(gravity, ["x", "y"], "behavior.gravity");
    const movement = record(behavior.movement, "behavior.movement");
    exactKeys(movement, ["speed", "acceleration"], "behavior.movement");
    const ordinary = record(behavior.ordinaryTransitions, "behavior.ordinaryTransitions");
    exactKeys(ordinary, ["cooldownMs", "weights"], "behavior.ordinaryTransitions");
    const flip = record(behavior.flip, "behavior.flip");
    exactKeys(
        flip,
        ["enabled", "cooldownMs", "sampleMax", "triggerMin", "triggerMax"],
        "behavior.flip",
    );
    const dragging = record(behavior.dragging, "behavior.dragging");
    exactKeys(
        dragging,
        ["enabled", "throwVelocityMultiplier", "maxThrowSpeed"],
        "behavior.dragging",
    );
    const climbing = record(behavior.climbing, "behavior.climbing");
    exactKeys(
        climbing,
        [
            "enabled",
            "randomJumpSampleMax",
            "randomJumpTrigger",
            "jumpDurationMs",
            "pauseSampleMax",
            "pauseTriggerMax",
            "pauseMinMs",
            "pauseMaxMs",
        ],
        "behavior.climbing",
    );
    const transitions = record(behavior.supportedTransitions, "behavior.supportedTransitions");
    const transitionKeys = [
        "initialDrop",
        "jumpToFall",
        "wallToClimb",
        "climbToCrawl",
        "crawlEdgeToJump",
        "dragToThrow",
    ] as const;
    exactKeys(transitions, transitionKeys, "behavior.supportedTransitions");

    const sampleMax = numberValue(flip.sampleMax, "behavior.flip.sampleMax", LIMITS.sample, true);
    const triggerMin = numberValue(
        flip.triggerMin,
        "behavior.flip.triggerMin",
        { min: 0, max: sampleMax },
        true,
    );
    const triggerMax = numberValue(
        flip.triggerMax,
        "behavior.flip.triggerMax",
        { min: triggerMin, max: sampleMax },
        true,
    );
    const randomJumpSampleMax = numberValue(
        climbing.randomJumpSampleMax,
        "behavior.climbing.randomJumpSampleMax",
        LIMITS.sample,
        true,
    );
    const pauseSampleMax = numberValue(
        climbing.pauseSampleMax,
        "behavior.climbing.pauseSampleMax",
        LIMITS.sample,
        true,
    );
    const pauseMinMs = numberValue(
        climbing.pauseMinMs,
        "behavior.climbing.pauseMinMs",
        LIMITS.positiveDurationMs,
        true,
    );
    const pauseMaxMs = numberValue(
        climbing.pauseMaxMs,
        "behavior.climbing.pauseMaxMs",
        { min: pauseMinMs, max: LIMITS.positiveDurationMs.max },
        true,
    );

    return {
        scale: numberValue(behavior.scale, "behavior.scale", LIMITS.scale),
        animationFrameRate: numberValue(
            behavior.animationFrameRate,
            "behavior.animationFrameRate",
            LIMITS.animationFrameRate,
            true,
        ),
        gravity: {
            x: numberValue(gravity.x, "behavior.gravity.x", LIMITS.gravity),
            y: numberValue(gravity.y, "behavior.gravity.y", LIMITS.gravity),
        },
        movement: {
            speed: numberValue(movement.speed, "behavior.movement.speed", LIMITS.movement),
            acceleration: numberValue(
                movement.acceleration,
                "behavior.movement.acceleration",
                LIMITS.movement,
            ),
        },
        ordinaryTransitions: {
            cooldownMs: numberValue(
                ordinary.cooldownMs,
                "behavior.ordinaryTransitions.cooldownMs",
                LIMITS.positiveDurationMs,
                true,
            ),
            weights: validateWeights(ordinary.weights, roles, animations),
        },
        flip: {
            enabled: booleanValue(flip.enabled, "behavior.flip.enabled"),
            cooldownMs: numberValue(
                flip.cooldownMs,
                "behavior.flip.cooldownMs",
                LIMITS.durationMs,
                true,
            ),
            sampleMax,
            triggerMin,
            triggerMax,
        },
        dragging: {
            enabled: booleanValue(dragging.enabled, "behavior.dragging.enabled"),
            throwVelocityMultiplier: numberValue(
                dragging.throwVelocityMultiplier,
                "behavior.dragging.throwVelocityMultiplier",
                LIMITS.throwVelocityMultiplier,
            ),
            maxThrowSpeed: numberValue(
                dragging.maxThrowSpeed,
                "behavior.dragging.maxThrowSpeed",
                LIMITS.throwSpeed,
            ),
        },
        climbing: {
            enabled: booleanValue(climbing.enabled, "behavior.climbing.enabled"),
            randomJumpSampleMax,
            randomJumpTrigger: numberValue(
                climbing.randomJumpTrigger,
                "behavior.climbing.randomJumpTrigger",
                { min: 0, max: randomJumpSampleMax },
                true,
            ),
            jumpDurationMs: numberValue(
                climbing.jumpDurationMs,
                "behavior.climbing.jumpDurationMs",
                LIMITS.positiveDurationMs,
                true,
            ),
            pauseSampleMax,
            pauseTriggerMax: numberValue(
                climbing.pauseTriggerMax,
                "behavior.climbing.pauseTriggerMax",
                { min: 0, max: pauseSampleMax },
                true,
            ),
            pauseMinMs,
            pauseMaxMs,
        },
        supportedTransitions: Object.fromEntries(
            transitionKeys.map((key) => [
                key,
                booleanValue(transitions[key], `behavior.supportedTransitions.${key}`),
            ]),
        ) as unknown as CompanionProfile["behavior"]["supportedTransitions"],
    };
}

export function validateCompanionProfile(
    value: unknown,
    artworkRegistry: Readonly<Record<string, BuiltInArtwork>> = BUILT_IN_ARTWORK,
): ValidatedCompanionProfile {
    const profile = record(value, "profile");
    exactKeys(profile, PROFILE_KEYS, "profile", ["optionalAnimationRoles"]);
    if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION) fail("schemaVersion is not supported");

    const id = identifier(profile.id, "id");
    const displayName = stringValue(profile.displayName, "displayName", LIMITS.displayNameLength);
    const artworkId = identifier(profile.artworkId, "artworkId");
    const artwork = artworkRegistry[artworkId];
    if (!artwork) fail("artworkId is not registered");
    const frame = validateFrame(profile.frame, artwork);
    const animations = validateAnimations(profile.animations, frame);
    const roles = validateRoles(profile.roles, animations);
    const optionalAnimationRoles = validateOptionalAnimationRoles(
        profile.optionalAnimationRoles,
        animations,
    );

    return deepFreeze({
        schemaVersion: PROFILE_SCHEMA_VERSION,
        id,
        displayName,
        attribution: validateAttribution(profile.attribution),
        artworkId,
        artwork: { ...artwork },
        frame,
        animations,
        roles,
        optionalAnimationRoles,
        behavior: validateBehavior(profile.behavior, roles, animations),
    });
}
