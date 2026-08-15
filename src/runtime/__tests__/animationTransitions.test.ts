import { describe, expect, it } from "vitest";
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
} from "../animationTransitions";

describe("sit transition sequencing", () => {
    it("plays sit-down once before looping sit when the role is mapped", () => {
        const result = enterSit(initialCompanionTransitionState(), true);
        expect(result.state.phase).toBe("sit-down");
        expect(result.state.generation).toBe(1);
        expect(result.intention).toEqual({ type: "play-optional-once", optionalRole: "sit-down" });

        const completed = completeSitDown(result.state, 1);
        expect(completed.state.phase).toBe("sitting");
        expect(completed.intention).toEqual({ type: "play-role", role: "sit" });
    });

    it("does not replay sit-down for a repeated sit request", () => {
        const sitting = enterSit(initialCompanionTransitionState(), true);
        const again = enterSit(sitting.state, true);
        expect(again.intention.type).toBe("none");
        expect(again.state).toBe(sitting.state);

        const afterComplete = completeSitDown(sitting.state, 1);
        const repeated = enterSit(afterComplete.state, true);
        expect(repeated.intention.type).toBe("none");
        expect(repeated.state.phase).toBe("sitting");
    });

    it("loops sit directly when no sit-down mapping is present (Blooky compatibility)", () => {
        const result = enterSit(initialCompanionTransitionState(), false);
        expect(result.state.phase).toBe("sitting");
        expect(result.intention).toEqual({ type: "play-role", role: "sit" });
    });
});

describe("stand-up transition sequencing", () => {
    it("plays stand-up once before the newest grounded target when leaving sit", () => {
        const sitting = completeSitDown(enterSit(initialCompanionTransitionState(), true).state, 1);
        const leaving = leaveSit(sitting.state, "walk", true);
        expect(leaving.state.phase).toBe("stand-up");
        expect(leaving.state.generation).toBe(2);
        expect(leaving.state.pendingTarget).toBe("walk");
        expect(leaving.intention).toEqual({ type: "play-optional-once", optionalRole: "stand-up" });

        const completed = completeStandUp(leaving.state, 2);
        expect(completed.state.phase).toBe("rest");
        expect(completed.intention).toEqual({ type: "play-role", role: "walk" });
    });

    it("switches directly to the target when no stand-up mapping is present (Blooky compatibility)", () => {
        const sitting = completeSitDown(enterSit(initialCompanionTransitionState(), true).state, 1);
        const leaving = leaveSit(sitting.state, "walk", false);
        expect(leaving.state.phase).toBe("rest");
        expect(leaving.intention).toEqual({ type: "play-role", role: "walk" });
    });

    it("goes directly to the target when the companion is not sitting", () => {
        const result = leaveSit(initialCompanionTransitionState(), "walk", true);
        expect(result.state.phase).toBe("rest");
        expect(result.intention).toEqual({ type: "play-role", role: "walk" });
    });

    it("updates to the newest valid grounded target while stand-up is already in progress", () => {
        const sitting = completeSitDown(enterSit(initialCompanionTransitionState(), true).state, 1);
        const first = leaveSit(sitting.state, "walk", true);
        const superseded = leaveSit(first.state, "greet", true);
        expect(superseded.intention.type).toBe("none");
        expect(superseded.state.phase).toBe("stand-up");
        expect(superseded.state.pendingTarget).toBe("greet");

        const completed = completeStandUp(superseded.state, first.state.generation);
        expect(completed.intention).toEqual({ type: "play-role", role: "greet" });
    });
});

describe("transition cancellation", () => {
    it.each([
        "cursor-observe",
        "cursor-approach",
        "cursor-greet",
        "airborne",
        "climbing",
        "crawling",
        "dragged",
    ] as const)("cancels an in-progress sit-down immediately for %s", (interruption) => {
        const sitDown = enterSit(initialCompanionTransitionState(), true);
        const canceled = cancelTransition(sitDown.state, interruption);
        expect(canceled.state.phase).toBe("rest");
        expect(canceled.state.generation).toBe(sitDown.state.generation + 1);
        expect(canceled.intention.type).toBe("none");
    });

    it("cancels an in-progress stand-up immediately", () => {
        const sitting = completeSitDown(enterSit(initialCompanionTransitionState(), true).state, 1);
        const standingUp = leaveSit(sitting.state, "walk", true);
        const canceled = cancelTransition(standingUp.state, "dragged");
        expect(canceled.state.phase).toBe("rest");
        expect(canceled.intention.type).toBe("none");
    });

    it("leaves the rest phase unchanged", () => {
        const rest = initialCompanionTransitionState();
        const canceled = cancelTransition(rest, "airborne");
        expect(canceled.state).toBe(rest);
        expect(canceled.intention.type).toBe("none");
    });

    it("reports active one-shots for ordinary-selection gating", () => {
        expect(isSitTransitionActive(initialCompanionTransitionState())).toBe(false);
        expect(isSitTransitionActive(enterSit(initialCompanionTransitionState(), true).state)).toBe(true);
        const sitting = completeSitDown(enterSit(initialCompanionTransitionState(), true).state, 1);
        expect(isSitTransitionActive(sitting.state)).toBe(false);
        expect(isSitTransitionActive(leaveSit(sitting.state, "walk", true).state)).toBe(true);
    });
});

describe("stale completion events are inert", () => {
    it("ignores a sit-down completion after the transition is canceled", () => {
        const sitDown = enterSit(initialCompanionTransitionState(), true);
        const generation = sitDown.state.generation;
        const canceled = cancelTransition(sitDown.state, "cursor-observe");

        const completed = completeSitDown(canceled.state, generation);
        expect(completed.intention.type).toBe("none");
    });

    it("ignores a stand-up completion after the transition is canceled", () => {
        const sitting = completeSitDown(enterSit(initialCompanionTransitionState(), true).state, 1);
        const standingUp = leaveSit(sitting.state, "walk", true);
        const generation = standingUp.state.generation;
        const canceled = cancelTransition(standingUp.state, "airborne");

        const completed = completeStandUp(canceled.state, generation);
        expect(completed.intention.type).toBe("none");
    });

    it("ignores a completion with a mismatched generation", () => {
        const sitDown = enterSit(initialCompanionTransitionState(), true);
        const stale = completeSitDown(sitDown.state, sitDown.state.generation + 99);
        expect(stale.intention.type).toBe("none");
        expect(stale.state).toBe(sitDown.state);
    });

    it("ignores a stand-up completion while not in the stand-up phase", () => {
        const sitting = completeSitDown(enterSit(initialCompanionTransitionState(), true).state, 1);
        const stale = completeStandUp(sitting.state, sitting.state.generation);
        expect(stale.intention.type).toBe("none");
    });
});

describe("surface hold lifecycle", () => {
    it("begins a hold with an incrementing generation and resumes from the same state", () => {
        const began = beginSurfaceHold(initialSurfaceHoldState(), "crawling");
        expect(began.state.active).toBe(true);
        expect(began.state.mechanicalState).toBe("crawling");
        expect(began.generation).toBe(1);

        const resumed = resumeSurfaceHold(began.state, began.generation, "crawling");
        expect(resumed.shouldResume).toBe(true);
        expect(resumed.state.active).toBe(false);
    });

    it("does not resume a hold after the mechanical state changes", () => {
        const began = beginSurfaceHold(initialSurfaceHoldState(), "climbing");
        const resumed = resumeSurfaceHold(began.state, began.generation, "airborne");
        expect(resumed.shouldResume).toBe(false);
        expect(resumed.state.active).toBe(true);
    });

    it("does not resume a hold from a stale generation", () => {
        const began = beginSurfaceHold(initialSurfaceHoldState(), "crawling");
        const resumed = resumeSurfaceHold(began.state, began.generation + 1, "crawling");
        expect(resumed.shouldResume).toBe(false);
    });

    it("invalidates a hold so a stale resume timeout is inert", () => {
        const began = beginSurfaceHold(initialSurfaceHoldState(), "climbing");
        const generation = began.generation;
        const invalidated = invalidateSurfaceHold(began.state);
        expect(invalidated.active).toBe(false);

        const resumed = resumeSurfaceHold(invalidated, generation, "climbing");
        expect(resumed.shouldResume).toBe(false);
    });

    it("starts a fresh hold with a new generation after invalidation", () => {
        const first = beginSurfaceHold(initialSurfaceHoldState(), "crawling");
        const invalidated = invalidateSurfaceHold(first.state);
        const second = beginSurfaceHold(invalidated, "crawling");
        expect(second.generation).toBe(first.generation + 1);
        expect(second.state.active).toBe(true);
    });

    it("leaves an inactive hold unchanged on invalidation", () => {
        const rest = initialSurfaceHoldState();
        expect(invalidateSurfaceHold(rest)).toBe(rest);
    });
});
