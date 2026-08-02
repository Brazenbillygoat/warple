import type { DesktopItemSummary } from "./desktopEnvironment";
import type { Rectangle } from "./geometry";

export const ICON_AWARENESS_TUNING = Object.freeze({
    awarenessRadius: 320,
    noticeDwellMs: 500,
    clearance: 24,
    standOffHysteresis: 12,
    inspectDwellMs: 1250,
    sitDwellMs: 2500,
    cooldownMs: 5000,
    verticalEligibilityGap: 128,
    boundsTolerance: 2,
});

export type HorizontalDirection = "left" | "right";

interface OwnedTarget {
    readonly targetId: string;
    readonly targetBounds: Rectangle;
    readonly standCenterX: number;
    readonly facing: HorizontalDirection;
}

export type IconAwarenessState =
    | { readonly phase: "idle" }
    | ({ readonly phase: "notice"; readonly startedAt: number } & OwnedTarget)
    | ({ readonly phase: "approach" } & OwnedTarget)
    | ({ readonly phase: "inspect"; readonly startedAt: number } & OwnedTarget)
    | ({ readonly phase: "sit"; readonly startedAt: number } & OwnedTarget)
    | { readonly phase: "cooldown"; readonly startedAt: number; readonly completedTargetId: string };

export type IconAwarenessIntention =
    | { readonly type: "none" }
    | { readonly type: "observe"; readonly direction: HorizontalDirection }
    | { readonly type: "approach"; readonly direction: HorizontalDirection; readonly targetCenterX: number }
    | { readonly type: "inspect"; readonly direction: HorizontalDirection }
    | { readonly type: "sit"; readonly direction: HorizontalDirection }
    | { readonly type: "disengage" };

export interface IconAwarenessResult {
    readonly state: IconAwarenessState;
    readonly intention: IconAwarenessIntention;
    readonly requestDetailsFor?: string;
}

export interface IconAwarenessObservation {
    readonly nowMs: number;
    readonly available: boolean;
    readonly desktopShellActive: boolean;
    readonly groundedEligible: boolean;
    readonly higherPriorityOwned: boolean;
    readonly icons: readonly DesktopItemSummary[];
    readonly companionBounds: Rectangle;
    readonly workArea: Rectangle;
}

const IDLE: IconAwarenessState = Object.freeze({ phase: "idle" });
const NO_ACTION: IconAwarenessIntention = Object.freeze({ type: "none" });

export function initialIconAwarenessState(): IconAwarenessState {
    return IDLE;
}

export function updateIconAwareness(
    previous: IconAwarenessState,
    observation: IconAwarenessObservation,
): IconAwarenessResult {
    const nowMs = finiteTime(observation.nowMs);
    if (!safeObservation(observation)) return cancel(previous, nowMs);

    if (previous.phase === "cooldown") {
        if (nowMs - previous.startedAt < ICON_AWARENESS_TUNING.cooldownMs) {
            return { state: previous, intention: NO_ACTION };
        }
        previous = IDLE;
    }

    if (
        !observation.available ||
        !observation.desktopShellActive ||
        !observation.groundedEligible ||
        observation.higherPriorityOwned
    ) {
        return cancel(previous, nowMs);
    }

    if (previous.phase === "idle") {
        const target = selectTarget(observation);
        if (!target) return { state: previous, intention: NO_ACTION };
        const state: IconAwarenessState = Object.freeze({
            phase: "notice",
            startedAt: nowMs,
            ...target,
        });
        return {
            state,
            intention: { type: "observe", direction: target.facing },
            requestDetailsFor: target.targetId,
        };
    }

    if (previous.phase === "cooldown") return { state: previous, intention: NO_ACTION };

    const target = observation.icons.find((icon) => icon.id === previous.targetId);
    if (
        !target ||
        !eligibleIcon(target, observation.companionBounds, observation.workArea) ||
        !rectanglesEquivalent(target.bounds, previous.targetBounds)
    ) {
        return cancel(previous, nowMs);
    }

    switch (previous.phase) {
        case "notice":
            if (nowMs - previous.startedAt < ICON_AWARENESS_TUNING.noticeDwellMs) {
                return {
                    state: previous,
                    intention: { type: "observe", direction: previous.facing },
                };
            }
            return approach(previous, observation.companionBounds, nowMs);
        case "approach":
            return approach(previous, observation.companionBounds, nowMs);
        case "inspect":
            if (nowMs - previous.startedAt < ICON_AWARENESS_TUNING.inspectDwellMs) {
                return {
                    state: previous,
                    intention: { type: "inspect", direction: previous.facing },
                };
            }
            return {
                state: Object.freeze({ ...previous, phase: "sit", startedAt: nowMs }),
                intention: { type: "sit", direction: previous.facing },
            };
        case "sit":
            if (nowMs - previous.startedAt < ICON_AWARENESS_TUNING.sitDwellMs) {
                return {
                    state: previous,
                    intention: { type: "sit", direction: previous.facing },
                };
            }
            return completed(previous.targetId, nowMs);
    }

    return { state: previous, intention: NO_ACTION };
}

export function cancelIconAwareness(
    previous: IconAwarenessState,
    nowMs: number,
): IconAwarenessResult {
    return cancel(previous, finiteTime(nowMs));
}

function approach(
    target: OwnedTarget,
    companionBounds: Rectangle,
    nowMs: number,
): IconAwarenessResult {
    const centerX = companionBounds.x + companionBounds.width / 2;
    const distance = target.standCenterX - centerX;
    if (Math.abs(distance) <= ICON_AWARENESS_TUNING.standOffHysteresis) {
        return {
            state: Object.freeze({ ...target, phase: "inspect", startedAt: nowMs }),
            intention: { type: "inspect", direction: target.facing },
        };
    }
    return {
        state: Object.freeze({ ...target, phase: "approach" }),
        intention: {
            type: "approach",
            direction: distance < 0 ? "left" : "right",
            targetCenterX: target.standCenterX,
        },
    };
}

function selectTarget(observation: IconAwarenessObservation): OwnedTarget | undefined {
    const companionCenterX = observation.companionBounds.x + observation.companionBounds.width / 2;
    return observation.icons
        .map((icon) => {
            if (!eligibleIcon(icon, observation.companionBounds, observation.workArea)) return undefined;
            const stand = standPosition(icon.bounds, observation.companionBounds, observation.workArea);
            if (!stand) return undefined;
            return {
                icon,
                stand,
                priority: icon.selected && icon.focused ? 0 : icon.selected ? 1 : 2,
                distance: rectangleDistance(observation.companionBounds, icon.bounds),
                horizontalDistance: Math.abs(stand.standCenterX - companionCenterX),
            };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
        .sort(
            (a, b) =>
                a.priority - b.priority ||
                a.distance - b.distance ||
                a.horizontalDistance - b.horizontalDistance ||
                a.icon.sourceOrder - b.icon.sourceOrder ||
                a.icon.id.localeCompare(b.icon.id),
        )
        .map(({ icon, stand }) =>
            Object.freeze({
                targetId: icon.id,
                targetBounds: Object.freeze({ ...icon.bounds }),
                standCenterX: stand.standCenterX,
                facing: stand.facing,
            }),
        )[0];
}

function eligibleIcon(icon: DesktopItemSummary, companion: Rectangle, workArea: Rectangle): boolean {
    if (icon.attributes.hidden || !validRectangle(icon.bounds) || !contains(workArea, icon.bounds)) {
        return false;
    }
    if (verticalGap(companion, icon.bounds) > ICON_AWARENESS_TUNING.verticalEligibilityGap) {
        return false;
    }
    return rectangleDistance(companion, icon.bounds) <= ICON_AWARENESS_TUNING.awarenessRadius;
}

function standPosition(
    icon: Rectangle,
    companion: Rectangle,
    workArea: Rectangle,
): { readonly standCenterX: number; readonly facing: HorizontalDirection } | undefined {
    const halfWidth = companion.width / 2;
    const left = icon.x - ICON_AWARENESS_TUNING.clearance - halfWidth;
    const right = icon.x + icon.width + ICON_AWARENESS_TUNING.clearance + halfWidth;
    const minimum = workArea.x + halfWidth;
    const maximum = workArea.x + workArea.width - halfWidth;
    const options = [
        left >= minimum && left <= maximum ? { standCenterX: left, facing: "right" as const } : undefined,
        right >= minimum && right <= maximum ? { standCenterX: right, facing: "left" as const } : undefined,
    ].filter((option): option is NonNullable<typeof option> => option !== undefined);
    const center = companion.x + companion.width / 2;
    return options.sort(
        (a, b) => Math.abs(a.standCenterX - center) - Math.abs(b.standCenterX - center),
    )[0];
}

function cancel(previous: IconAwarenessState, nowMs: number): IconAwarenessResult {
    if (previous.phase === "idle" || previous.phase === "cooldown") {
        return { state: previous, intention: NO_ACTION };
    }
    return completed(previous.targetId, nowMs);
}

function completed(targetId: string, nowMs: number): IconAwarenessResult {
    return {
        state: Object.freeze({ phase: "cooldown", startedAt: nowMs, completedTargetId: targetId }),
        intention: { type: "disengage" },
    };
}

function safeObservation(observation: IconAwarenessObservation): boolean {
    return (
        Number.isFinite(observation.nowMs) &&
        validRectangle(observation.companionBounds) &&
        validRectangle(observation.workArea) &&
        Array.isArray(observation.icons)
    );
}

function rectangleDistance(a: Rectangle, b: Rectangle): number {
    const horizontal = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
    const vertical = verticalGap(a, b);
    return Math.hypot(horizontal, vertical);
}

function verticalGap(a: Rectangle, b: Rectangle): number {
    return Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
}

function rectanglesEquivalent(a: Rectangle, b: Rectangle): boolean {
    const tolerance = ICON_AWARENESS_TUNING.boundsTolerance;
    return (
        Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance
    );
}

function contains(outer: Rectangle, inner: Rectangle): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
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
