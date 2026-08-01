import { describe, expect, it } from "vitest";
import {
    CURSOR_AWARENESS_TUNING,
    completeCursorGreeting,
    initialCursorAwarenessState,
    updateCursorAwareness,
    type CursorAwarenessObservation,
    type CursorAwarenessState,
} from "../cursorAwareness";

const baseObservation: CursorAwarenessObservation = {
    nowMs: 0,
    eligible: true,
    cursor: { x: 600, y: 500 },
    companionCenter: { x: 500, y: 500 },
    companionBounds: { min: { x: 455, y: 455 }, max: { x: 545, y: 545 } },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};

function step(
    state: CursorAwarenessState,
    nowMs: number,
    changes: Partial<CursorAwarenessObservation> = {},
) {
    return updateCursorAwareness(state, { ...baseObservation, ...changes, nowMs });
}

describe("cursor awareness policy", () => {
    it.each([
        ["absent", undefined],
        ["non-finite x", { x: Number.NaN, y: 500 }],
        ["non-finite y", { x: 600, y: Number.POSITIVE_INFINITY }],
        ["outside work area", { x: 2000, y: 500 }],
    ])("does not start for an %s cursor", (_label, cursor) => {
        expect(step(initialCursorAwarenessState(), 0, { cursor }).state.phase).toBe("idle");
    });

    it("notices immediately but requires continuous dwell before approach", () => {
        const noticed = step(initialCursorAwarenessState(), 0);
        expect(noticed).toMatchObject({ state: { phase: "notice" }, intention: { type: "observe" } });
        expect(step(noticed.state, 749).state.phase).toBe("notice");
        expect(step(noticed.state, 750)).toMatchObject({
            state: { phase: "approach" },
            intention: { type: "observe" },
        });
    });

    it("resets dwell after leaving and re-entering", () => {
        const noticed = step(initialCursorAwarenessState(), 0);
        const outside = step(noticed.state, 400, { cursor: { x: 900, y: 500 } });
        const disengaged = step(outside.state, 800, { cursor: { x: 900, y: 500 } });
        expect(disengaged.intention.type).toBe("disengage");
        expect(step(disengaged.state, 3800).state.phase).toBe("notice");
    });

    it("approaches in the cursor direction and uses stand-off hysteresis", () => {
        const noticed = step(initialCursorAwarenessState(), 0, { cursor: { x: 700, y: 500 } });
        const approaching = step(noticed.state, 750, { cursor: { x: 700, y: 500 } });
        expect(approaching.intention).toEqual({ type: "approach", direction: "right" });

        const stopped = step(approaching.state, 900, { cursor: { x: 595, y: 500 } });
        expect(stopped).toMatchObject({
            state: { phase: "approach", movement: "stopped" },
            intention: { type: "observe" },
        });
        const jitter = step(stopped.state, 1000, { cursor: { x: 605, y: 500 } });
        expect(jitter).toMatchObject({ state: { movement: "stopped" }, intention: { type: "observe" } });
        const resumed = step(jitter.state, 1100, { cursor: { x: 620, y: 500 } });
        expect(resumed.intention).toEqual({ type: "approach", direction: "right" });
    });

    it("greets exactly once after arrival and stationary dwell", () => {
        const noticed = step(initialCursorAwarenessState(), 0);
        const arrived = step(noticed.state, 750);
        const greeting = step(arrived.state, 1500, { cursor: { x: 605, y: 505 } });
        expect(greeting.intention).toEqual({ type: "greet", direction: "right" });
        expect(step(greeting.state, 1600).intention.type).toBe("none");

        const completed = completeCursorGreeting(greeting.state, 1800);
        expect(completed).toEqual({
            state: {
                phase: "cooldown",
                startedAt: 1800,
                requireCursorExit: true,
                cursorExited: false,
            },
            intention: { type: "disengage" },
        });
        expect(step(completed.state, 6000).state.phase).toBe("cooldown");
        const exited = step(completed.state, 6000, { cursor: { x: 1000, y: 500 } });
        expect(exited.state.phase).toBe("idle");
    });

    it("resets greeting dwell when the cursor moves beyond tolerance", () => {
        const noticed = step(initialCursorAwarenessState(), 0);
        const arrived = step(noticed.state, 750);
        const moved = step(arrived.state, 1400, { cursor: { x: 580, y: 500 } });
        expect(moved.state.phase).toBe("approach");
        expect(step(moved.state, 1500, { cursor: { x: 580, y: 500 } }).state.phase).toBe("approach");
        expect(step(moved.state, 2150, { cursor: { x: 580, y: 500 } }).intention.type).toBe("greet");
    });

    it("requires vertical greeting proximity", () => {
        const cursor = { x: 600, y: 300 };
        const noticed = step(initialCursorAwarenessState(), 0, { cursor });
        const arrived = step(noticed.state, 750, { cursor });
        expect(step(arrived.state, 2000, { cursor }).state.phase).toBe("approach");
    });

    it("uses grace before disengaging outside the radius", () => {
        const noticed = step(initialCursorAwarenessState(), 0);
        const grace = step(noticed.state, 100, { cursor: { x: 900, y: 500 } });
        expect(grace.state.phase).toBe("notice");
        expect(step(grace.state, 449, { cursor: { x: 900, y: 500 } }).state.phase).toBe("notice");
        expect(step(grace.state, 450, { cursor: { x: 900, y: 500 } }).intention.type).toBe("disengage");
    });

    it.each(["notice", "approach", "greeting"] as const)(
        "cancels %s immediately when eligibility is lost",
        (phase) => {
            const states: Record<typeof phase, CursorAwarenessState> = {
                notice: { phase: "notice", startedAt: 0, facing: "right" },
                approach: { phase: "approach", facing: "right", movement: "right" },
                greeting: { phase: "greeting", facing: "right" },
            };
            expect(step(states[phase], 100, { eligible: false }).intention.type).toBe("disengage");
        },
    );

    it("enforces deterministic cooldown before reacquisition", () => {
        const canceled = step(
            { phase: "notice", startedAt: 0, facing: "right" },
            100,
            { eligible: false },
        );
        expect(step(canceled.state, 3099).state.phase).toBe("cooldown");
        expect(step(canceled.state, 3100).state.phase).toBe("notice");
    });

    it("returns only finite, bounded directions and state data", () => {
        let state = initialCursorAwarenessState();
        for (let nowMs = 0; nowMs <= 5000; nowMs += 125) {
            const result = step(state, nowMs, {
                cursor: { x: 500 + Math.sin(nowMs) * 250, y: 500 },
            });
            state = result.state;
            expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
            if ("direction" in result.intention) {
                expect(["left", "right"]).toContain(result.intention.direction);
            }
        }
        expect(CURSOR_AWARENESS_TUNING.awarenessExitRadius).toBeGreaterThan(
            CURSOR_AWARENESS_TUNING.awarenessRadius,
        );
    });
});
