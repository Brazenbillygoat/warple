import type { DesktopItemSummary } from "./desktopEnvironment";
import type { Rectangle } from "./geometry";

export const ICON_AWARENESS_TUNING = Object.freeze({
    awarenessRadius: 320,
    noticeDwellMs: 500,
    clearance: 24,
    standOffHysteresis: 12,
    inspectDwellMs: 1250,
    mountDurationMs: 650,
    mountTimeoutMs: 900,
    sitDwellMs: 2500,
    departDurationMs: 650,
    cooldownMs: 5000,
    verticalEligibilityGap: 128,
    boundsTolerance: 2,
    directStepHeight: 96,
    jumpBound: 288,
    platformThickness: 8,
    minimumPlatformWidth: 24,
});

export type HorizontalDirection = "left" | "right";
export type LockedSide = "left" | "right";
export type MountStrategy = "direct" | "elevated" | "unreachable";

export interface MountPlan {
    readonly strategy: MountStrategy;
    readonly lockedSide: LockedSide;
    readonly platform: Rectangle;
    readonly topCenterX: number;
}

interface OwnedTarget {
    readonly targetId: string;
    readonly targetBounds: Rectangle;
    readonly standCenterX: number;
    readonly facing: HorizontalDirection;
}

interface MountTarget extends OwnedTarget {
    readonly mount: MountPlan;
}

export type IconAwarenessState =
    | { readonly phase: "idle" }
    | ({ readonly phase: "notice"; readonly startedAt: number } & OwnedTarget)
    | ({ readonly phase: "approach" } & OwnedTarget)
    | ({ readonly phase: "inspect"; readonly startedAt: number } & OwnedTarget)
    | ({ readonly phase: "mount"; readonly startedAt: number } & MountTarget)
    | ({ readonly phase: "loaf"; readonly startedAt: number } & MountTarget)
    | ({ readonly phase: "depart"; readonly startedAt: number } & MountTarget)
    | { readonly phase: "cooldown"; readonly startedAt: number; readonly completedTargetId: string };

export type IconAwarenessIntention =
    | { readonly type: "none" }
    | { readonly type: "observe"; readonly direction: HorizontalDirection }
    | { readonly type: "approach"; readonly direction: HorizontalDirection; readonly targetCenterX: number }
    | { readonly type: "inspect"; readonly direction: HorizontalDirection }
    | { readonly type: "mount"; readonly direction: HorizontalDirection; readonly plan: MountPlan }
    | { readonly type: "sit"; readonly direction: HorizontalDirection }
    | { readonly type: "depart"; readonly direction: HorizontalDirection; readonly targetCenterX: number }
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

    let preferDifferentThan: string | undefined;
    if (previous.phase === "cooldown") {
        if (nowMs - previous.startedAt < ICON_AWARENESS_TUNING.cooldownMs) {
            return { state: previous, intention: NO_ACTION };
        }
        preferDifferentThan = previous.completedTargetId;
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
        const target = selectTarget(observation, preferDifferentThan);
        if (!target) return { state: previous, intention: NO_ACTION };
        return {
            state: Object.freeze({ phase: "notice", startedAt: nowMs, ...target }),
            intention: { type: "observe", direction: target.facing },
            requestDetailsFor: target.targetId,
        };
    }

    if (previous.phase === "cooldown") return { state: previous, intention: NO_ACTION };

    const target = observation.icons.find((icon) => icon.id === previous.targetId);
    if (!target) return cancel(previous, nowMs);
    // Once the companion has committed to a target (mounting, loafing, or
    // departing) it intentionally leaves the selection range, so only the
    // target's intrinsic validity and bounds are re-gated — not the
    // companion-relative distance/vertical gap used for selection.
    const committed =
        previous.phase === "mount" || previous.phase === "loaf" || previous.phase === "depart";
    const stillValid = committed
        ? targetIntrinsicValid(target, observation.workArea)
        : eligibleIcon(target, observation.companionBounds, observation.workArea);
    if (!stillValid || !rectanglesEquivalent(target.bounds, previous.targetBounds)) {
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
            return beginMount(previous, observation.companionBounds, observation.workArea, nowMs);
        case "mount": {
            const unreachable = previous.mount.strategy === "unreachable";
            const duration = unreachable
                ? ICON_AWARENESS_TUNING.mountTimeoutMs
                : ICON_AWARENESS_TUNING.mountDurationMs;
            if (nowMs - previous.startedAt < duration) {
                return unreachable
                    ? {
                          state: previous,
                          intention: { type: "inspect", direction: previous.facing },
                      }
                    : {
                          state: previous,
                          intention: {
                              type: "mount",
                              direction: previous.facing,
                              plan: previous.mount,
                          },
                      };
            }
            if (unreachable) return completed(previous.targetId, nowMs);
            return {
                state: Object.freeze({ ...previous, phase: "loaf", startedAt: nowMs }),
                intention: { type: "sit", direction: previous.facing },
            };
        }
        case "loaf":
            if (nowMs - previous.startedAt < ICON_AWARENESS_TUNING.sitDwellMs) {
                return {
                    state: previous,
                    intention: { type: "sit", direction: previous.facing },
                };
            }
            return {
                state: Object.freeze({ ...previous, phase: "depart", startedAt: nowMs }),
                intention: {
                    type: "depart",
                    direction: previous.facing,
                    targetCenterX: previous.standCenterX,
                },
            };
        case "depart":
            if (nowMs - previous.startedAt < ICON_AWARENESS_TUNING.departDurationMs) {
                return {
                    state: previous,
                    intention: {
                        type: "depart",
                        direction: previous.facing,
                        targetCenterX: previous.standCenterX,
                    },
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

function beginMount(
    target: OwnedTarget,
    companionBounds: Rectangle,
    workArea: Rectangle,
    nowMs: number,
): IconAwarenessResult {
    const plan = computeMountPlan(target.targetBounds, companionBounds, workArea, target.facing);
    const state: IconAwarenessState = Object.freeze({
        phase: "mount",
        startedAt: nowMs,
        targetId: target.targetId,
        targetBounds: target.targetBounds,
        standCenterX: target.standCenterX,
        facing: target.facing,
        mount: plan,
    });
    if (plan.strategy === "unreachable") {
        return { state, intention: { type: "inspect", direction: target.facing } };
    }
    return {
        state,
        intention: { type: "mount", direction: target.facing, plan },
    };
}

function computeMountPlan(
    icon: Rectangle,
    companion: Rectangle,
    workArea: Rectangle,
    facing: HorizontalDirection,
): MountPlan {
    const lockedSide: LockedSide = facing === "right" ? "left" : "right";
    const companionFeet = companion.y + companion.height;
    const reach = companionFeet - icon.y;
    let strategy: MountStrategy =
        reach <= ICON_AWARENESS_TUNING.directStepHeight
            ? "direct"
            : reach <= ICON_AWARENESS_TUNING.jumpBound
              ? "elevated"
              : "unreachable";
    const platform = createIconPlatform(icon, workArea);
    if (!platform) strategy = "unreachable";
    const platformRect = platform ?? {
        x: icon.x,
        y: icon.y,
        width: icon.width,
        height: ICON_AWARENESS_TUNING.platformThickness,
    };
    const topCenterX = platform ? platform.x + platform.width / 2 : icon.x + icon.width / 2;
    return Object.freeze({
        strategy,
        lockedSide,
        platform: Object.freeze(platformRect),
        topCenterX,
    });
}

function createIconPlatform(icon: Rectangle, workArea: Rectangle): Rectangle | undefined {
    const left = Math.max(icon.x, workArea.x);
    const right = Math.min(icon.x + icon.width, workArea.x + workArea.width);
    const width = right - left;
    if (width < ICON_AWARENESS_TUNING.minimumPlatformWidth) return undefined;
    const y = Math.max(icon.y, workArea.y);
    if (y >= workArea.y + workArea.height) return undefined;
    return {
        x: left,
        y,
        width,
        height: ICON_AWARENESS_TUNING.platformThickness,
    };
}

function selectTarget(
    observation: IconAwarenessObservation,
    preferDifferentThan: string | undefined,
): OwnedTarget | undefined {
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
                repeatPenalty:
                    preferDifferentThan !== undefined && icon.id === preferDifferentThan ? 1 : 0,
            };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
        .sort(
            (a, b) =>
                a.repeatPenalty - b.repeatPenalty ||
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

function targetIntrinsicValid(icon: DesktopItemSummary, workArea: Rectangle): boolean {
    return (
        !icon.attributes.hidden &&
        validRectangle(icon.bounds) &&
        contains(workArea, icon.bounds)
    );
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
