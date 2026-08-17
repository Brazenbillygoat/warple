import { describe, expect, it } from "vitest";
import type { DesktopItemSummary } from "../desktopEnvironment";
import type { Rectangle } from "../geometry";
import {
    ICON_AWARENESS_TUNING,
    initialIconAwarenessState,
    updateIconAwareness,
    type IconAwarenessObservation,
    type IconAwarenessState,
} from "../iconAwareness";

const workArea = { x: 0, y: 0, width: 1000, height: 700 };
const companionBounds = { x: 400, y: 560, width: 80, height: 90 };
const companionFeet = companionBounds.y + companionBounds.height;

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

function tallIcon(id: string, x: number, topY: number, height: number): DesktopItemSummary {
    return icon(id, x, {
        position: { x, y: topY },
        bounds: { x, y: topY, width: 64, height },
    });
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

const standLeftOfNear = { ...companionBounds, x: 520 - 24 - companionBounds.width };
const nearIcon = (): DesktopItemSummary => icon("near", 520);
const nearIcons = (): readonly DesktopItemSummary[] => [nearIcon()];

function advanceToMount(
    state: IconAwarenessState,
    icons: readonly DesktopItemSummary[] = nearIcons(),
    companion: Rectangle = standLeftOfNear,
) {
    const approaching = update(state, { nowMs: ICON_AWARENESS_TUNING.noticeDwellMs, icons });
    const inspecting = update(approaching.state, { nowMs: 600, companionBounds: companion, icons });
    return update(inspecting.state, { nowMs: 1850, companionBounds: companion, icons });
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

    it("notices, approaches, inspects, mounts, loafs, departs, and cools down by elapsed time", () => {
        const noticed = update(initialIconAwarenessState());
        expect(noticed.intention.type).toBe("observe");
        expect(noticed.requestDetailsFor).toBe("near");
        expect(update(noticed.state, { nowMs: 499 }).intention.type).toBe("observe");

        const approaching = update(noticed.state, { nowMs: 500 });
        expect(approaching.intention).toMatchObject({ type: "approach", direction: "right" });

        const inspecting = update(approaching.state, { nowMs: 600, companionBounds: standLeftOfNear });
        expect(inspecting.intention.type).toBe("inspect");
        expect(update(inspecting.state, { nowMs: 1849, companionBounds: standLeftOfNear }).intention.type).toBe("inspect");

        const mounting = update(inspecting.state, { nowMs: 1850, companionBounds: standLeftOfNear });
        expect(mounting.intention.type).toBe("mount");
        expect(mounting.state.phase).toBe("mount");
        expect(update(mounting.state, { nowMs: 2499, companionBounds: standLeftOfNear }).intention.type).toBe("mount");

        const loafing = update(mounting.state, { nowMs: 2500, companionBounds: standLeftOfNear });
        expect(loafing.intention.type).toBe("sit");
        expect(loafing.state.phase).toBe("loaf");
        expect(update(loafing.state, { nowMs: 4999, companionBounds: standLeftOfNear }).intention.type).toBe("sit");

        const departing = update(loafing.state, { nowMs: 5000, companionBounds: standLeftOfNear });
        expect(departing.intention.type).toBe("depart");
        expect(departing.state.phase).toBe("depart");
        expect(update(departing.state, { nowMs: 5649, companionBounds: standLeftOfNear }).intention.type).toBe("depart");

        const disengaged = update(departing.state, { nowMs: 5650, companionBounds: standLeftOfNear });
        expect(disengaged.intention.type).toBe("disengage");
        expect(disengaged.state.phase).toBe("cooldown");
        expect(update(disengaged.state, { nowMs: 10649, companionBounds: standLeftOfNear }).state.phase).toBe("cooldown");
        expect(update(disengaged.state, { nowMs: 10650, companionBounds: standLeftOfNear }).state.phase).toBe("notice");
    });

    it("uses clearance and hysteresis without covering the icon", () => {
        const noticed = update(initialIconAwarenessState());
        const approaching = update(noticed.state, { nowMs: ICON_AWARENESS_TUNING.noticeDwellMs });
        expect(approaching.intention).toEqual({ type: "approach", direction: "right", targetCenterX: 456 });

        const withinHysteresis = { ...companionBounds, x: 456 - companionBounds.width / 2 + 10 };
        expect(update(approaching.state, { nowMs: 600, companionBounds: withinHysteresis }).intention.type).toBe("inspect");
        expect(withinHysteresis.x + withinHysteresis.width).toBeLessThan(520);
    });

    it("locks the near side and materializes a bounded top platform for a direct target", () => {
        const mounting = advanceToMount(update(initialIconAwarenessState()).state);
        expect(mounting.intention).toMatchObject({
            type: "mount",
            plan: {
                strategy: "direct",
                lockedSide: "left",
                platform: { x: 520, y: 570, width: 64, height: 8 },
                topCenterX: 552,
            },
        });
    });

    it("requests one bounded directed jump for elevated reachable targets", () => {
        const elevatedTop = companionFeet - ICON_AWARENESS_TUNING.directStepHeight - 40;
        const elevated = tallIcon("elevated", 520, elevatedTop, 80);
        const elevatedIcons = [elevated];
        const mounting = advanceToMount(
            update(initialIconAwarenessState(), { icons: elevatedIcons }).state,
            elevatedIcons,
            standLeftOfNear,
        );
        expect(mounting.intention).toMatchObject({
            type: "mount",
            plan: { strategy: "elevated", lockedSide: "left" },
        });
    });

    it("times out safely for unreachable targets without mounting", () => {
        const unreachableTop = companionFeet - ICON_AWARENESS_TUNING.jumpBound - 60;
        const unreachable = tallIcon("unreachable", 520, unreachableTop, companionFeet - unreachableTop + 10);
        const unreachableIcons = [unreachable];
        const mounting = advanceToMount(
            update(initialIconAwarenessState(), { icons: unreachableIcons }).state,
            unreachableIcons,
            standLeftOfNear,
        );
        expect(mounting.state).toMatchObject({ phase: "mount", mount: { strategy: "unreachable" } });
        expect(mounting.intention.type).toBe("inspect");
        expect(update(mounting.state, { nowMs: 2749, companionBounds: standLeftOfNear, icons: unreachableIcons }).intention.type).toBe("inspect");
        const timedOut = update(mounting.state, { nowMs: 2750, companionBounds: standLeftOfNear, icons: unreachableIcons });
        expect(timedOut.intention.type).toBe("disengage");
        expect(timedOut.state.phase).toBe("cooldown");
    });

    it("departs back to the near-side stand position", () => {
        const mounting = advanceToMount(update(initialIconAwarenessState()).state);
        const loafing = update(mounting.state, { nowMs: 2500, companionBounds: standLeftOfNear });
        const departing = update(loafing.state, { nowMs: 5000, companionBounds: standLeftOfNear });
        expect(departing.intention).toMatchObject({
            type: "depart",
            direction: "right",
            targetCenterX: 456,
        });
    });

    it("re-gates only target validity once committed, not companion distance", () => {
        const elevatedTop = companionFeet - ICON_AWARENESS_TUNING.directStepHeight - 40;
        const elevatedIcons = [tallIcon("elevated", 520, elevatedTop, 80)];
        const mounting = advanceToMount(
            update(initialIconAwarenessState(), { icons: elevatedIcons }).state,
            elevatedIcons,
            standLeftOfNear,
        );
        const loafing = update(mounting.state, { nowMs: 2500, companionBounds: standLeftOfNear, icons: elevatedIcons });
        expect(loafing.state.phase).toBe("loaf");

        // The companion descends to the floor (far below the elevated icon) while
        // departing; the committed visit must not cancel on companion distance.
        const floorCompanion = {
            x: standLeftOfNear.x,
            y: workArea.height - companionBounds.height,
            width: companionBounds.width,
            height: companionBounds.height,
        };
        const departing = update(loafing.state, { nowMs: 5000, companionBounds: floorCompanion, icons: elevatedIcons });
        expect(departing.state.phase).toBe("depart");
        expect(departing.intention.type).toBe("depart");

        // Hiding the committed target still cancels the visit safely.
        const hiddenElevated = icon("elevated", 520, {
            position: { x: 520, y: elevatedTop },
            bounds: { x: 520, y: elevatedTop, width: 64, height: 80 },
            attributes: { ...icon("elevated", 520).attributes, hidden: true },
        });
        const cancelled = update(loafing.state, {
            nowMs: 2501,
            companionBounds: standLeftOfNear,
            icons: [hiddenElevated],
        });
        expect(cancelled.intention.type).toBe("disengage");
    });

    it("prefers a different eligible item after cooldown but reuses the sole item", () => {
        const icons = [icon("alpha", 520), icon("beta", 620)];
        const first = update(initialIconAwarenessState(), { icons });
        expect(first.state).toMatchObject({ phase: "notice", targetId: "alpha" });

        const afterAlpha: IconAwarenessState = {
            phase: "cooldown",
            startedAt: 0,
            completedTargetId: "alpha",
        };
        const next = update(afterAlpha, { nowMs: ICON_AWARENESS_TUNING.cooldownMs, icons });
        expect(next.state).toMatchObject({ phase: "notice", targetId: "beta" });

        const sole = update(afterAlpha, {
            nowMs: ICON_AWARENESS_TUNING.cooldownMs,
            icons: [icon("alpha", 520)],
        });
        expect(sole.state).toMatchObject({ phase: "notice", targetId: "alpha" });
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

    it.each([
        ["mounting", (state: IconAwarenessState) => update(state, { nowMs: 1850, companionBounds: standLeftOfNear }).state],
        ["loafing", (state: IconAwarenessState) => update(state, { nowMs: 2500, companionBounds: standLeftOfNear }).state],
        ["departing", (state: IconAwarenessState) => update(state, { nowMs: 5000, companionBounds: standLeftOfNear }).state],
    ])("cancels from %s into cooldown", (_label, advance) => {
        const noticed = update(initialIconAwarenessState());
        const mounting = advanceToMount(noticed.state);
        const active = advance(mounting.state);
        const cancelled = update(active, { icons: [] });
        expect(cancelled.intention.type).toBe("disengage");
        expect(cancelled.state.phase).toBe("cooldown");
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
