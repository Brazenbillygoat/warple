import type { Rectangle } from "./geometry";

export type HorizontalDirection = "left" | "right";

export const CURSOR_AWARENESS_TUNING = Object.freeze({
    awarenessRadius: 320,
    awarenessExitRadius: 344,
    noticeDwellMs: 750,
    standOffDistance: 96,
    standOffHysteresis: 16,
    greetingVerticalDistance: 96,
    stationaryTolerance: 12,
    greetingDwellMs: 750,
    disengageGraceMs: 350,
    cooldownMs: 3000,
    facingDeadZone: 8,
});

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface BodyBounds {
    readonly min: Point;
    readonly max: Point;
}

export type CursorAwarenessState =
    | { readonly phase: "idle" }
    | {
          readonly phase: "notice";
          readonly startedAt: number;
          readonly facing: HorizontalDirection;
          readonly outsideSince?: number;
      }
    | {
          readonly phase: "approach";
          readonly facing: HorizontalDirection;
          readonly movement: HorizontalDirection | "stopped";
          readonly stationarySince?: number;
          readonly stationaryAnchor?: Point;
          readonly outsideSince?: number;
      }
    | { readonly phase: "greeting"; readonly facing: HorizontalDirection }
    | {
          readonly phase: "cooldown";
          readonly startedAt: number;
          readonly requireCursorExit: boolean;
          readonly cursorExited: boolean;
      };

export type CursorAwarenessIntention =
    | { readonly type: "none" }
    | { readonly type: "observe"; readonly direction: HorizontalDirection }
    | { readonly type: "approach"; readonly direction: HorizontalDirection }
    | { readonly type: "greet"; readonly direction: HorizontalDirection }
    | { readonly type: "disengage" };

export interface CursorAwarenessObservation {
    readonly nowMs: number;
    readonly eligible: boolean;
    readonly cursor?: Point;
    readonly companionCenter: Point;
    readonly companionBounds: BodyBounds;
    readonly workArea: Rectangle;
}

export interface CursorAwarenessResult {
    readonly state: CursorAwarenessState;
    readonly intention: CursorAwarenessIntention;
}

const IDLE_STATE: CursorAwarenessState = Object.freeze({ phase: "idle" });
const NO_ACTION: CursorAwarenessIntention = Object.freeze({ type: "none" });

export function initialCursorAwarenessState(): CursorAwarenessState {
    return IDLE_STATE;
}

export function updateCursorAwareness(
    previous: CursorAwarenessState,
    observation: CursorAwarenessObservation,
): CursorAwarenessResult {
    const nowMs = finiteTime(observation.nowMs);

    if (previous.phase === "cooldown") {
        const cursorExited =
            previous.cursorExited ||
            !isSafeObservation(observation) ||
            cursorDistance(observation) > CURSOR_AWARENESS_TUNING.awarenessExitRadius;
        const state = { ...previous, cursorExited };
        if (
            nowMs - previous.startedAt < CURSOR_AWARENESS_TUNING.cooldownMs ||
            (previous.requireCursorExit && !cursorExited)
        ) {
            return { state, intention: NO_ACTION };
        }
        previous = IDLE_STATE;
    }

    if (!observation.eligible || !isSafeObservation(observation)) {
        return cancel(previous, nowMs);
    }
    if (previous.phase === "cooldown") return { state: previous, intention: NO_ACTION };

    const cursor = observation.cursor!;
    const center = observation.companionCenter;
    const distance = Math.hypot(cursor.x - center.x, cursor.y - center.y);
    const active = previous.phase !== "idle";
    const radius = active
        ? CURSOR_AWARENESS_TUNING.awarenessExitRadius
        : CURSOR_AWARENESS_TUNING.awarenessRadius;

    if (distance > radius) {
        if (previous.phase === "idle") return { state: previous, intention: NO_ACTION };
        if (previous.phase === "greeting") return cancel(previous, nowMs);

        const outsideSince = previous.outsideSince ?? nowMs;
        if (nowMs - outsideSince >= CURSOR_AWARENESS_TUNING.disengageGraceMs) {
            return cancel(previous, nowMs);
        }
        return {
            state: { ...previous, outsideSince },
            intention: holdIntention(previous),
        };
    }

    const facing = selectFacing(previous, cursor.x - center.x);
    if (previous.phase === "idle") {
        return {
            state: { phase: "notice", startedAt: nowMs, facing },
            intention: { type: "observe", direction: facing },
        };
    }

    if (previous.phase === "notice") {
        if (nowMs - previous.startedAt < CURSOR_AWARENESS_TUNING.noticeDwellMs) {
            return {
                state: { phase: "notice", startedAt: previous.startedAt, facing },
                intention: { type: "observe", direction: facing },
            };
        }
        const movement = approachMovement("stopped", cursor.x - center.x);
        return approachResult(facing, movement, cursor, observation, nowMs);
    }

    if (previous.phase === "approach") {
        const movement = approachMovement(previous.movement, cursor.x - center.x);
        return approachResult(facing, movement, cursor, observation, nowMs, previous);
    }

    return { state: previous, intention: NO_ACTION };
}

export function completeCursorGreeting(
    previous: CursorAwarenessState,
    nowMs: number,
): CursorAwarenessResult {
    if (previous.phase !== "greeting") return { state: previous, intention: NO_ACTION };
    return {
        state: {
            phase: "cooldown",
            startedAt: finiteTime(nowMs),
            requireCursorExit: true,
            cursorExited: false,
        },
        intention: { type: "disengage" },
    };
}

export function cancelCursorAwareness(
    previous: CursorAwarenessState,
    nowMs: number,
): CursorAwarenessResult {
    return cancel(previous, finiteTime(nowMs));
}

function approachResult(
    facing: HorizontalDirection,
    movement: HorizontalDirection | "stopped",
    cursor: Point,
    observation: CursorAwarenessObservation,
    nowMs: number,
    previous?: Extract<CursorAwarenessState, { phase: "approach" }>,
): CursorAwarenessResult {
    if (movement !== "stopped" || !isGreetingProximity(cursor, observation.companionBounds)) {
        return {
            state: { phase: "approach", facing, movement },
            intention:
                movement === "stopped"
                    ? { type: "observe", direction: facing }
                    : { type: "approach", direction: movement },
        };
    }

    const anchor = previous?.stationaryAnchor;
    const remainsStationary = anchor && pointDistance(anchor, cursor) <= CURSOR_AWARENESS_TUNING.stationaryTolerance;
    const stationarySince = remainsStationary ? previous?.stationarySince ?? nowMs : nowMs;
    const stationaryAnchor = remainsStationary ? anchor : cursor;

    if (nowMs - stationarySince >= CURSOR_AWARENESS_TUNING.greetingDwellMs) {
        return {
            state: { phase: "greeting", facing },
            intention: { type: "greet", direction: facing },
        };
    }

    return {
        state: {
            phase: "approach",
            facing,
            movement,
            stationarySince,
            stationaryAnchor,
        },
        intention: { type: "observe", direction: facing },
    };
}

function approachMovement(
    previous: HorizontalDirection | "stopped",
    horizontalDistance: number,
): HorizontalDirection | "stopped" {
    const absoluteDistance = Math.abs(horizontalDistance);
    if (previous === "stopped") {
        if (
            absoluteDistance <=
            CURSOR_AWARENESS_TUNING.standOffDistance + CURSOR_AWARENESS_TUNING.standOffHysteresis
        ) {
            return "stopped";
        }
    } else if (absoluteDistance <= CURSOR_AWARENESS_TUNING.standOffDistance) {
        return "stopped";
    }
    return horizontalDistance < 0 ? "left" : "right";
}

function selectFacing(previous: CursorAwarenessState, horizontalDistance: number): HorizontalDirection {
    if (Math.abs(horizontalDistance) <= CURSOR_AWARENESS_TUNING.facingDeadZone) {
        return "facing" in previous ? previous.facing : "right";
    }
    return horizontalDistance < 0 ? "left" : "right";
}

function holdIntention(previous: CursorAwarenessState): CursorAwarenessIntention {
    if (previous.phase === "approach" && previous.movement !== "stopped") {
        return { type: "approach", direction: previous.movement };
    }
    if ("facing" in previous) return { type: "observe", direction: previous.facing };
    return NO_ACTION;
}

function cancel(previous: CursorAwarenessState, nowMs: number): CursorAwarenessResult {
    if (previous.phase === "idle" || previous.phase === "cooldown") {
        return { state: previous, intention: NO_ACTION };
    }
    return {
        state: {
            phase: "cooldown",
            startedAt: nowMs,
            requireCursorExit: false,
            cursorExited: false,
        },
        intention: { type: "disengage" },
    };
}

function cursorDistance(observation: CursorAwarenessObservation): number {
    if (!observation.cursor) return Number.POSITIVE_INFINITY;
    return pointDistance(observation.cursor, observation.companionCenter);
}

function isSafeObservation(observation: CursorAwarenessObservation): boolean {
    const { cursor, companionCenter, companionBounds, workArea } = observation;
    if (!cursor) return false;
    const values = [
        cursor.x,
        cursor.y,
        companionCenter.x,
        companionCenter.y,
        companionBounds.min.x,
        companionBounds.min.y,
        companionBounds.max.x,
        companionBounds.max.y,
        workArea.x,
        workArea.y,
        workArea.width,
        workArea.height,
    ];
    if (!values.every(Number.isFinite) || workArea.width <= 0 || workArea.height <= 0) return false;
    if (
        companionBounds.min.x > companionBounds.max.x ||
        companionBounds.min.y > companionBounds.max.y
    ) {
        return false;
    }
    return (
        cursor.x >= workArea.x &&
        cursor.x <= workArea.x + workArea.width &&
        cursor.y >= workArea.y &&
        cursor.y <= workArea.y + workArea.height
    );
}

function isGreetingProximity(cursor: Point, bounds: BodyBounds): boolean {
    const verticalDistance =
        cursor.y < bounds.min.y
            ? bounds.min.y - cursor.y
            : cursor.y > bounds.max.y
              ? cursor.y - bounds.max.y
              : 0;
    return verticalDistance <= CURSOR_AWARENESS_TUNING.greetingVerticalDistance;
}

function pointDistance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function finiteTime(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}
