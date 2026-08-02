import { describe, expect, it } from "vitest";
import type { DesktopItemSummary } from "../desktopEnvironment";
import {
    ICON_AWARENESS_TUNING,
    initialIconAwarenessState,
    updateIconAwareness,
    type IconAwarenessObservation,
    type IconAwarenessState,
} from "../iconAwareness";

const workArea = { x: 0, y: 0, width: 1000, height: 700 };
const companionBounds = { x: 400, y: 560, width: 80, height: 90 };

function icon(
    id: string,
    x: number,
    overrides: Partial<DesktopItemSummary> = {},
): DesktopItemSummary {
    return {
        id,
        displayName: id,
        editingName: id,
        position: { x, y: 570 },
        bounds: { x, y: 570, width: 64, height: 80 },
        selected: false,
        focused: false,
        sourceOrder: 0,
        shellKinds: ["item"],
        parsingPath: `shell:${id}`,
        attributes: {
            fileSystem: false,
            folder: false,
            shortcut: false,
            hidden: false,
            readOnly: false,
            shared: false,
            copyable: true,
            movable: true,
            linkable: true,
        },
        ...overrides,
    };
}

function observation(overrides: Partial<IconAwarenessObservation> = {}): IconAwarenessObservation {
    return {
        nowMs: 0,
        available: true,
        desktopShellActive: true,
        groundedEligible: true,
        higherPriorityOwned: false,
        icons: [icon("near", 520)],
        companionBounds,
        workArea,
        ...overrides,
    };
}

function update(
    state: IconAwarenessState,
    overrides: Partial<IconAwarenessObservation> = {},
) {
    return updateIconAwareness(state, observation(overrides));
}

describe("icon awareness policy", () => {
    it("prioritizes focused selected, then selected, then nearest with stable order", () => {
        const icons = [
            icon("nearest", 500, { sourceOrder: 2 }),
            icon("selected", 650, { selected: true, sourceOrder: 1 }),
            icon("focused-selected", 680, { selected: true, focused: true, sourceOrder: 3 }),
        ];
        expect(update(initialIconAwarenessState(), { icons }).state).toMatchObject({
            phase: "notice",
            targetId: "focused-selected",
        });

        const selectedOnly = icons.filter((candidate) => candidate.id !== "focused-selected");
        expect(update(initialIconAwarenessState(), { icons: selectedOnly }).state).toMatchObject({
            targetId: "selected",
        });

        expect(
            update(initialIconAwarenessState(), {
                icons: [icon("later", 520, { sourceOrder: 2 }), icon("earlier", 520, { sourceOrder: 1 })],
            }).state,
        ).toMatchObject({ targetId: "earlier" });
    });

    it("notices, approaches, inspects, sits, and disengages by elapsed time", () => {
        const noticed = update(initialIconAwarenessState());
        expect(noticed.intention.type).toBe("observe");
        expect(noticed.requestDetailsFor).toBe("near");
        expect(update(noticed.state, { nowMs: 499 }).intention.type).toBe("observe");

        const approaching = update(noticed.state, { nowMs: 500 });
        expect(approaching.intention).toMatchObject({ type: "approach", direction: "right" });

        const arrivedBounds = { ...companionBounds, x: 520 - 24 - companionBounds.width };
        const inspecting = update(approaching.state, { nowMs: 600, companionBounds: arrivedBounds });
        expect(inspecting.intention.type).toBe("inspect");
        expect(update(inspecting.state, { nowMs: 1849, companionBounds: arrivedBounds }).intention.type).toBe("inspect");

        const sitting = update(inspecting.state, { nowMs: 1850, companionBounds: arrivedBounds });
        expect(sitting.intention.type).toBe("sit");
        const disengaged = update(sitting.state, { nowMs: 4350, companionBounds: arrivedBounds });
        expect(disengaged.intention.type).toBe("disengage");
        expect(disengaged.state.phase).toBe("cooldown");
        expect(update(disengaged.state, { nowMs: 9000, companionBounds: arrivedBounds }).state.phase).toBe("cooldown");
        expect(update(disengaged.state, { nowMs: 9350, companionBounds: arrivedBounds }).state.phase).toBe("notice");
    });

    it("uses clearance and hysteresis without covering the icon", () => {
        const noticed = update(initialIconAwarenessState());
        const approaching = update(noticed.state, { nowMs: ICON_AWARENESS_TUNING.noticeDwellMs });
        expect(approaching.intention).toEqual({ type: "approach", direction: "right", targetCenterX: 456 });

        const withinHysteresis = { ...companionBounds, x: 456 - companionBounds.width / 2 + 10 };
        expect(update(approaching.state, { nowMs: 600, companionBounds: withinHysteresis }).intention.type).toBe("inspect");
        expect(withinHysteresis.x + withinHysteresis.width).toBeLessThan(520);
    });

    it.each([
        ["cursor ownership", { higherPriorityOwned: true }],
        ["mechanical state", { groundedEligible: false }],
        ["desktop unavailable", { available: false }],
        ["desktop hidden", { desktopShellActive: false }],
        ["target removed", { icons: [] }],
        ["target moved", { icons: [icon("near", 530)] }],
        ["target hidden", { icons: [icon("near", 520, { attributes: { ...icon("base", 0).attributes, hidden: true } })] }],
    ])("cancels immediately on %s", (_label, overrides) => {
        const noticed = update(initialIconAwarenessState());
        expect(update(noticed.state, overrides).intention.type).toBe("disengage");
    });

    it("rejects unreachable and off-work-area icons", () => {
        const result = update(initialIconAwarenessState(), {
            icons: [
                icon("far", 900),
                icon("offscreen", 980),
                icon("vertical", 520, { bounds: { x: 520, y: 100, width: 64, height: 80 } }),
            ],
        });
        expect(result.state.phase).toBe("idle");
    });
});
