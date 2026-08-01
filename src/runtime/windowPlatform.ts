import type { ForegroundWindowCandidate } from "./desktopEnvironment";
import type { Rectangle } from "./geometry";

export const WINDOW_PLATFORM_TUNING = Object.freeze({
    stabilityDwellMs: 350,
    boundsTolerance: 2,
    minimumMargin: 16,
    thickness: 8,
});

export type WindowPlatformState =
    | { readonly phase: "idle" }
    | {
          readonly phase: "waiting";
          readonly candidateId: string;
          readonly candidateBounds: Rectangle;
          readonly stableSince: number;
      }
    | {
          readonly phase: "active";
          readonly candidateId: string;
          readonly candidateBounds: Rectangle;
          readonly platform: Rectangle;
      };

export type WindowPlatformIntention =
    | { readonly type: "none" }
    | { readonly type: "wait" }
    | { readonly type: "remove" }
    | { readonly type: "add"; readonly platform: Rectangle; readonly candidateId: string };

export interface WindowPlatformResult {
    readonly state: WindowPlatformState;
    readonly intention: WindowPlatformIntention;
}

export interface WindowPlatformObservation {
    readonly nowMs: number;
    readonly candidate?: ForegroundWindowCandidate;
    readonly workArea: Rectangle;
    readonly companionBounds: Rectangle;
}

const IDLE: WindowPlatformState = Object.freeze({ phase: "idle" });
const NONE: WindowPlatformIntention = Object.freeze({ type: "none" });
const WAIT: WindowPlatformIntention = Object.freeze({ type: "wait" });

export function initialWindowPlatformState(): WindowPlatformState {
    return IDLE;
}

export function updateWindowPlatform(
    previous: WindowPlatformState,
    observation: WindowPlatformObservation,
): WindowPlatformResult {
    const nowMs = finiteTime(observation.nowMs);
    const candidate = safeCandidate(observation.candidate, observation.workArea);

    if (previous.phase === "active") {
        if (
            !candidate ||
            candidate.id !== previous.candidateId ||
            !rectanglesEquivalent(candidate.bounds, previous.candidateBounds)
        ) {
            return {
                state: candidate ? waiting(candidate, nowMs) : IDLE,
                intention: { type: "remove" },
            };
        }
        return { state: previous, intention: NONE };
    }

    if (!candidate) return { state: IDLE, intention: NONE };
    if (
        previous.phase === "idle" ||
        previous.candidateId !== candidate.id ||
        !rectanglesEquivalent(previous.candidateBounds, candidate.bounds)
    ) {
        return { state: waiting(candidate, nowMs), intention: WAIT };
    }

    if (nowMs - previous.stableSince < WINDOW_PLATFORM_TUNING.stabilityDwellMs) {
        return { state: previous, intention: WAIT };
    }

    const platform = createPlatform(candidate.bounds, observation.workArea, observation.companionBounds);
    if (!platform) return { state: previous, intention: WAIT };
    const state: WindowPlatformState = Object.freeze({
        phase: "active",
        candidateId: candidate.id,
        candidateBounds: Object.freeze({ ...candidate.bounds }),
        platform: Object.freeze(platform),
    });
    return {
        state,
        intention: { type: "add", platform: state.platform, candidateId: candidate.id },
    };
}

function waiting(candidate: ForegroundWindowCandidate, nowMs: number): WindowPlatformState {
    return Object.freeze({
        phase: "waiting",
        candidateId: candidate.id,
        candidateBounds: Object.freeze({ ...candidate.bounds }),
        stableSince: nowMs,
    });
}

function createPlatform(
    bounds: Rectangle,
    workArea: Rectangle,
    companionBounds: Rectangle,
): Rectangle | undefined {
    if (!validRectangle(companionBounds)) return undefined;
    const left = Math.max(bounds.x, workArea.x);
    const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width);
    const bodyWidth = companionBounds.width;
    if (right - left < bodyWidth + WINDOW_PLATFORM_TUNING.minimumMargin) return undefined;
    const platform: Rectangle = {
        x: left,
        y: bounds.y,
        width: right - left,
        height: WINDOW_PLATFORM_TUNING.thickness,
    };
    if (rectanglesIntersect(platform, companionBounds)) return undefined;
    return platform;
}

function safeCandidate(
    candidate: ForegroundWindowCandidate | undefined,
    workArea: Rectangle,
): ForegroundWindowCandidate | undefined {
    if (!candidate || !candidate.id || !validRectangle(candidate.bounds) || !validRectangle(workArea)) {
        return undefined;
    }
    const left = Math.max(candidate.bounds.x, workArea.x);
    const top = Math.max(candidate.bounds.y, workArea.y);
    const right = Math.min(candidate.bounds.x + candidate.bounds.width, workArea.x + workArea.width);
    const bottom = Math.min(candidate.bounds.y + candidate.bounds.height, workArea.y + workArea.height);
    if (right <= left || bottom <= top || top >= workArea.y + workArea.height) return undefined;
    return Object.freeze({
        id: candidate.id,
        bounds: Object.freeze({ x: left, y: top, width: right - left, height: bottom - top }),
    });
}

function rectanglesEquivalent(a: Rectangle, b: Rectangle): boolean {
    const tolerance = WINDOW_PLATFORM_TUNING.boundsTolerance;
    return (
        Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance
    );
}

function rectanglesIntersect(a: Rectangle, b: Rectangle): boolean {
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}

function validRectangle(value: Rectangle): boolean {
    return (
        [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
        value.width > 0 &&
        value.height > 0
    );
}

function finiteTime(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}
