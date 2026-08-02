import { describe, expect, it } from "vitest";
import {
    initialWindowPlatformState,
    updateWindowPlatform,
    WINDOW_PLATFORM_TUNING,
    type WindowPlatformObservation,
    type WindowPlatformState,
} from "../windowPlatform";

const workArea = { x: 0, y: 20, width: 1000, height: 700 };
const companionBounds = { x: 200, y: 50, width: 80, height: 90 };
const candidate = { id: "window-one", bounds: { x: 100, y: 300, width: 600, height: 400 } };

function observe(
    previous: WindowPlatformState,
    nowMs: number,
    overrides: Partial<WindowPlatformObservation> = {},
) {
    return updateWindowPlatform(previous, {
        nowMs,
        candidate,
        workArea,
        companionBounds,
        ...overrides,
    });
}

describe("window platform policy", () => {
    it("adds one clipped platform only after stable elapsed time", () => {
        const waiting = observe(initialWindowPlatformState(), 100);
        expect(waiting.intention.type).toBe("wait");
        expect(observe(waiting.state, 100 + WINDOW_PLATFORM_TUNING.stabilityDwellMs - 1).intention.type).toBe("wait");

        const active = observe(waiting.state, 100 + WINDOW_PLATFORM_TUNING.stabilityDwellMs);
        expect(active.intention).toEqual({
            type: "add",
            candidateId: "window-one",
            platform: { x: 100, y: 300, width: 600, height: 8 },
        });
        expect(observe(active.state, 1000).intention.type).toBe("none");
    });

    it.each([
        ["close or foreground loss", undefined],
        ["identity change", { ...candidate, id: "window-two" }],
        ["move", { ...candidate, bounds: { ...candidate.bounds, x: 110 } }],
        ["resize", { ...candidate, bounds: { ...candidate.bounds, width: 650 } }],
    ])("removes immediately on %s", (_label, replacement) => {
        const waiting = observe(initialWindowPlatformState(), 0);
        const active = observe(waiting.state, WINDOW_PLATFORM_TUNING.stabilityDwellMs);
        const removed = observe(active.state, 1000, { candidate: replacement });
        expect(removed.intention.type).toBe("remove");
        if (replacement) {
            expect(removed.state.phase).toBe("waiting");
            expect(observe(removed.state, 1200, { candidate: replacement }).intention.type).toBe("wait");
        }
    });

    it("tolerates small bounds jitter without replacing the platform", () => {
        const waiting = observe(initialWindowPlatformState(), 0);
        const active = observe(waiting.state, WINDOW_PLATFORM_TUNING.stabilityDwellMs);
        expect(
            observe(active.state, 500, {
                candidate: { ...candidate, bounds: { ...candidate.bounds, x: 101, width: 599 } },
            }).intention.type,
        ).toBe("none");
    });

    it("rejects narrow and body-intersecting platform bands", () => {
        const narrow = { id: "narrow", bounds: { x: 100, y: 300, width: 90, height: 300 } };
        let waiting = observe(initialWindowPlatformState(), 0, { candidate: narrow });
        expect(observe(waiting.state, 500, { candidate: narrow }).intention.type).toBe("wait");

        waiting = observe(initialWindowPlatformState(), 0);
        expect(
            observe(waiting.state, 500, {
                companionBounds: { x: 200, y: 295, width: 80, height: 90 },
            }).intention.type,
        ).toBe("wait");
    });

    it("requires fresh dwell before adding a replacement", () => {
        const waiting = observe(initialWindowPlatformState(), 0);
        const active = observe(waiting.state, WINDOW_PLATFORM_TUNING.stabilityDwellMs);
        const replacement = { id: "replacement", bounds: { x: 300, y: 250, width: 500, height: 450 } };
        const removed = observe(active.state, 500, { candidate: replacement });
        expect(removed.intention.type).toBe("remove");
        expect(observe(removed.state, 849, { candidate: replacement }).intention.type).toBe("wait");
        expect(observe(removed.state, 850, { candidate: replacement }).intention.type).toBe("add");
    });
});
