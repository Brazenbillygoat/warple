import type { MechanicalState } from "./matterPolicy";
import type { OrdinaryRole } from "../profiles/types";

export type SitTransitionPhase = "rest" | "sit-down" | "sitting" | "stand-up";

export type TransitionInterruption =
    | "cursor-observe"
    | "cursor-approach"
    | "cursor-greet"
    | Exclude<MechanicalState, "grounded">;

export interface CompanionTransitionState {
    readonly phase: SitTransitionPhase;
    readonly generation: number;
    readonly pendingTarget: OrdinaryRole | undefined;
}

export type CompanionTransitionIntention =
    | { readonly type: "none" }
    | { readonly type: "play-role"; readonly role: OrdinaryRole }
    | {
          readonly type: "play-optional-once";
          readonly optionalRole: "sit-down" | "stand-up";
      };

export interface CompanionTransitionResult {
    readonly state: CompanionTransitionState;
    readonly intention: CompanionTransitionIntention;
}

export interface SurfaceHoldState {
    readonly active: boolean;
    readonly generation: number;
    readonly mechanicalState: "climbing" | "crawling" | undefined;
}

export interface SurfaceHoldBegin {
    readonly state: SurfaceHoldState;
    readonly generation: number;
}

export interface SurfaceHoldResume {
    readonly state: SurfaceHoldState;
    readonly shouldResume: boolean;
}

const NO_ACTION: CompanionTransitionIntention = Object.freeze({ type: "none" });

export function initialCompanionTransitionState(): CompanionTransitionState {
    return { phase: "rest", generation: 0, pendingTarget: undefined };
}

export function enterSit(
    previous: CompanionTransitionState,
    hasSitDown: boolean,
): CompanionTransitionResult {
    if (previous.phase === "sitting" || previous.phase === "sit-down") {
        return { state: previous, intention: NO_ACTION };
    }
    if (hasSitDown) {
        const generation = previous.generation + 1;
        return {
            state: { phase: "sit-down", generation, pendingTarget: undefined },
            intention: { type: "play-optional-once", optionalRole: "sit-down" },
        };
    }
    return {
        state: { phase: "sitting", generation: previous.generation, pendingTarget: undefined },
        intention: { type: "play-role", role: "sit" },
    };
}

export function completeSitDown(
    previous: CompanionTransitionState,
    generation: number,
): CompanionTransitionResult {
    if (previous.phase !== "sit-down" || previous.generation !== generation) {
        return { state: previous, intention: NO_ACTION };
    }
    return {
        state: { phase: "sitting", generation, pendingTarget: undefined },
        intention: { type: "play-role", role: "sit" },
    };
}

export function leaveSit(
    previous: CompanionTransitionState,
    target: OrdinaryRole,
    hasStandUp: boolean,
): CompanionTransitionResult {
    if (previous.phase === "stand-up") {
        return { state: { ...previous, pendingTarget: target }, intention: NO_ACTION };
    }
    if (previous.phase === "sitting" && hasStandUp) {
        const generation = previous.generation + 1;
        return {
            state: { phase: "stand-up", generation, pendingTarget: target },
            intention: { type: "play-optional-once", optionalRole: "stand-up" },
        };
    }
    return {
        state: { phase: "rest", generation: previous.generation, pendingTarget: undefined },
        intention: { type: "play-role", role: target },
    };
}

export function completeStandUp(
    previous: CompanionTransitionState,
    generation: number,
): CompanionTransitionResult {
    if (previous.phase !== "stand-up" || previous.generation !== generation || !previous.pendingTarget) {
        return { state: previous, intention: NO_ACTION };
    }
    const target = previous.pendingTarget;
    return {
        state: { phase: "rest", generation, pendingTarget: undefined },
        intention: { type: "play-role", role: target },
    };
}

export function cancelTransition(
    previous: CompanionTransitionState,
    _interruption: TransitionInterruption,
): CompanionTransitionResult {
    if (previous.phase === "rest") {
        return { state: previous, intention: NO_ACTION };
    }
    return {
        state: { phase: "rest", generation: previous.generation + 1, pendingTarget: undefined },
        intention: NO_ACTION,
    };
}

export function isSitTransitionActive(state: CompanionTransitionState): boolean {
    return state.phase === "sit-down" || state.phase === "stand-up";
}

export function initialSurfaceHoldState(): SurfaceHoldState {
    return { active: false, generation: 0, mechanicalState: undefined };
}

export function beginSurfaceHold(
    previous: SurfaceHoldState,
    mechanicalState: "climbing" | "crawling",
): SurfaceHoldBegin {
    const generation = previous.generation + 1;
    return {
        state: { active: true, generation, mechanicalState },
        generation,
    };
}

export function resumeSurfaceHold(
    previous: SurfaceHoldState,
    generation: number,
    currentState: MechanicalState,
): SurfaceHoldResume {
    if (
        previous.active &&
        previous.generation === generation &&
        previous.mechanicalState === currentState
    ) {
        return { state: { ...previous, active: false }, shouldResume: true };
    }
    return { state: previous, shouldResume: false };
}

export function invalidateSurfaceHold(previous: SurfaceHoldState): SurfaceHoldState {
    if (!previous.active) return previous;
    return { active: false, generation: previous.generation, mechanicalState: undefined };
}
