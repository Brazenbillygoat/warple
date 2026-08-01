import type { Rectangle } from "./geometry";
import type { WorldBoundaryContacts } from "./worldBounds";

export const MATTER_FIXED_HZ = 60;
export const MATTER_FIXED_DELTA_MS = 1000 / MATTER_FIXED_HZ;
export const MATTER_GRAVITY_SCALE = 0.000001;
export const MATTER_MAX_SEMANTIC_SPEED = 5000;
export const MATTER_MAX_SEMANTIC_ACCELERATION = 5000;

const CONTACT_AXIS_THRESHOLD = 0.5;
const ZERO_VECTOR = Object.freeze({ x: 0, y: 0 });

function clampScalar(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

export interface Vector {
    readonly x: number;
    readonly y: number;
}

export interface BodyHalfExtents {
    readonly x: number;
    readonly y: number;
}

export type ContactDirection = "up" | "down" | "left" | "right";

export interface CollisionSample {
    readonly pairId: string;
    readonly bodyAId: number;
    readonly bodyBId: number;
    readonly normal: Vector;
    readonly bodyALabel?: string;
    readonly bodyBLabel?: string;
}

export interface BodyIdRegistry {
    has(bodyId: number): boolean;
}

export interface NormalizedContact {
    readonly pairId: string;
    readonly otherBodyId: number;
    readonly otherLabel: string;
    readonly normal: Vector;
    readonly directions: readonly ContactDirection[];
}

export interface AggregatedContacts extends WorldBoundaryContacts {
    readonly normalized: readonly NormalizedContact[];
}

export type MechanicalState = "grounded" | "airborne" | "climbing" | "crawling" | "dragged";

export type ContactTransition =
    | "crawl-edge-departure"
    | "ceiling-crawl"
    | "ceiling-fall"
    | "landing"
    | "side"
    | "none";

export interface ContactTransitionOptions {
    readonly crawlEdgeDeparture: boolean;
    readonly ceilingToCrawl: boolean;
}

export function isFiniteVector(vector: Vector): boolean {
    return Number.isFinite(vector.x) && Number.isFinite(vector.y);
}

export function finiteVectorOrZero(vector: Vector): Vector {
    return isFiniteVector(vector) ? { x: vector.x, y: vector.y } : ZERO_VECTOR;
}

export function clampFiniteVector(vector: Vector, maximumMagnitude: number): Vector {
    if (!isFiniteVector(vector) || !Number.isFinite(maximumMagnitude) || maximumMagnitude <= 0) {
        return ZERO_VECTOR;
    }

    const magnitude = Math.hypot(vector.x, vector.y);
    if (!Number.isFinite(magnitude) || magnitude === 0) return ZERO_VECTOR;
    if (magnitude <= maximumMagnitude) return { x: vector.x, y: vector.y };

    const scale = maximumMagnitude / magnitude;
    return { x: vector.x * scale, y: vector.y * scale };
}

export function pixelsPerSecondToMatterVelocity(
    value: number,
    maximumMagnitude = MATTER_MAX_SEMANTIC_SPEED,
): number {
    if (!Number.isFinite(value) || !Number.isFinite(maximumMagnitude) || maximumMagnitude <= 0) {
        return 0;
    }
    return clampScalar(value, -maximumMagnitude, maximumMagnitude) / MATTER_FIXED_HZ;
}

export function pixelsPerSecondVectorToMatterVelocity(
    vector: Vector,
    maximumMagnitude = MATTER_MAX_SEMANTIC_SPEED,
): Vector {
    const bounded = clampFiniteVector(vector, maximumMagnitude);
    return {
        x: bounded.x / MATTER_FIXED_HZ,
        y: bounded.y / MATTER_FIXED_HZ,
    };
}

export function matterVelocityToPixelsPerSecond(vector: Vector): Vector {
    if (!isFiniteVector(vector)) return ZERO_VECTOR;
    return {
        x: vector.x * MATTER_FIXED_HZ,
        y: vector.y * MATTER_FIXED_HZ,
    };
}

export function createMatterGravity(vector: Vector): Vector & { readonly scale: number } {
    const bounded = clampFiniteVector(vector, MATTER_MAX_SEMANTIC_ACCELERATION);
    return {
        x: bounded.x,
        y: bounded.y,
        scale: MATTER_GRAVITY_SCALE,
    };
}

export function matterForceForSemanticAcceleration(
    acceleration: Vector,
    bodyMass: number,
): Vector {
    if (!Number.isFinite(bodyMass) || bodyMass <= 0) return ZERO_VECTOR;
    const bounded = clampFiniteVector(acceleration, MATTER_MAX_SEMANTIC_ACCELERATION);
    return {
        x: bounded.x * MATTER_GRAVITY_SCALE * bodyMass,
        y: bounded.y * MATTER_GRAVITY_SCALE * bodyMass,
    };
}

export function clampBodyCenterToRectangle(
    position: Vector,
    halfExtents: BodyHalfExtents,
    rectangle: Rectangle,
): Vector {
    if (
        !isFiniteVector(position) ||
        !isFiniteVector(halfExtents) ||
        halfExtents.x < 0 ||
        halfExtents.y < 0 ||
        !Number.isFinite(rectangle.x) ||
        !Number.isFinite(rectangle.y) ||
        !Number.isFinite(rectangle.width) ||
        !Number.isFinite(rectangle.height) ||
        rectangle.width < halfExtents.x * 2 ||
        rectangle.height < halfExtents.y * 2
    ) {
        return ZERO_VECTOR;
    }

    return {
        x: clampScalar(
            position.x,
            rectangle.x + halfExtents.x,
            rectangle.x + rectangle.width - halfExtents.x,
        ),
        y: clampScalar(
            position.y,
            rectangle.y + halfExtents.y,
            rectangle.y + rectangle.height - halfExtents.y,
        ),
    };
}

export function normalizeCollisionContact(
    sample: CollisionSample,
    companionBodyId: number,
): NormalizedContact | null {
    const companionIsBodyA = sample.bodyAId === companionBodyId;
    const companionIsBodyB = sample.bodyBId === companionBodyId;
    if (companionIsBodyA === companionIsBodyB || !isFiniteVector(sample.normal)) return null;

    const length = Math.hypot(sample.normal.x, sample.normal.y);
    if (!Number.isFinite(length) || length === 0) return null;

    // Matter reports the resolution direction for body A. Locomotion policy
    // receives the direction from the companion toward the contacted body.
    const orientation = companionIsBodyA ? -1 : 1;
    const normalizedX = (sample.normal.x / length) * orientation;
    const normalizedY = (sample.normal.y / length) * orientation;
    const normal = {
        x: Object.is(normalizedX, -0) ? 0 : normalizedX,
        y: Object.is(normalizedY, -0) ? 0 : normalizedY,
    };
    const directions: ContactDirection[] = [];
    if (normal.y <= -CONTACT_AXIS_THRESHOLD) directions.push("up");
    if (normal.y >= CONTACT_AXIS_THRESHOLD) directions.push("down");
    if (normal.x <= -CONTACT_AXIS_THRESHOLD) directions.push("left");
    if (normal.x >= CONTACT_AXIS_THRESHOLD) directions.push("right");

    return {
        pairId: sample.pairId,
        otherBodyId: companionIsBodyA ? sample.bodyBId : sample.bodyAId,
        otherLabel: companionIsBodyA
            ? (sample.bodyBLabel ?? `body-${sample.bodyBId}`)
            : (sample.bodyALabel ?? `body-${sample.bodyAId}`),
        normal,
        directions,
    };
}

export function filterCollisionSamplesByOtherBody(
    samples: readonly CollisionSample[],
    companionBodyId: number,
    allowedOtherBodies: BodyIdRegistry,
): CollisionSample[] {
    return samples.filter((sample) => {
        if (sample.bodyAId === companionBodyId && sample.bodyBId !== companionBodyId) {
            return allowedOtherBodies.has(sample.bodyBId);
        }
        if (sample.bodyBId === companionBodyId && sample.bodyAId !== companionBodyId) {
            return allowedOtherBodies.has(sample.bodyAId);
        }
        return false;
    });
}

export function mergeCollisionSamplesForPolicy(
    activeSamples: Iterable<CollisionSample>,
    pendingImpactSamples: Iterable<CollisionSample>,
): CollisionSample[] {
    const samplesByPairId = new Map<string, CollisionSample>();
    for (const sample of activeSamples) samplesByPairId.set(sample.pairId, sample);
    for (const sample of pendingImpactSamples) samplesByPairId.set(sample.pairId, sample);
    return [...samplesByPairId.values()];
}

export function aggregateCollisionContacts(
    samples: readonly CollisionSample[],
    companionBodyId: number,
): AggregatedContacts {
    const normalized = samples
        .map((sample) => normalizeCollisionContact(sample, companionBodyId))
        .filter((contact): contact is NormalizedContact => contact !== null)
        .sort((a, b) => a.pairId.localeCompare(b.pairId));

    return {
        up: normalized.some((contact) => contact.directions.includes("up")),
        down: normalized.some((contact) => contact.directions.includes("down")),
        left: normalized.some((contact) => contact.directions.includes("left")),
        right: normalized.some((contact) => contact.directions.includes("right")),
        normalized,
    };
}

export function suppressContactDirection(
    contacts: AggregatedContacts,
    direction: ContactDirection | undefined,
): AggregatedContacts {
    if (!direction || !contacts[direction]) return contacts;
    return { ...contacts, [direction]: false };
}

export function selectContactTransition(
    state: MechanicalState,
    contacts: WorldBoundaryContacts,
    options: ContactTransitionOptions,
): ContactTransition {
    if (state === "dragged") return "none";
    if (
        state === "crawling" &&
        (contacts.left || contacts.right) &&
        options.crawlEdgeDeparture
    ) {
        return "crawl-edge-departure";
    }
    if (contacts.up) {
        if (state === "crawling") return "none";
        return options.ceilingToCrawl ? "ceiling-crawl" : "ceiling-fall";
    }
    if (contacts.down) return "landing";
    if (contacts.left || contacts.right) return "side";
    return "none";
}
