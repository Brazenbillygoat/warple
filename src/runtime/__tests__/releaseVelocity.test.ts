import { describe, expect, it } from "vitest";
import { calculateReleaseVelocity } from "../releaseVelocity";

describe("release velocity", () => {
    it("scales a finite pointer gesture", () => {
        expect(calculateReleaseVelocity({ x: 3, y: 4 }, 2, 100)).toEqual({ x: 6, y: 8 });
    });

    it("limits the total speed without changing direction", () => {
        const velocity = calculateReleaseVelocity({ x: 3, y: 4 }, 10, 10);

        expect(velocity.x).toBeCloseTo(6);
        expect(velocity.y).toBeCloseTo(8);
        expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(10);
    });

    it.each([
        [{ x: Number.NaN, y: 1 }, 2, 100],
        [{ x: 1, y: Number.POSITIVE_INFINITY }, 2, 100],
        [{ x: 1, y: 1 }, Number.NaN, 100],
        [{ x: 1, y: 1 }, -1, 100],
        [{ x: 1, y: 1 }, 2, Number.POSITIVE_INFINITY],
        [{ x: 1, y: 1 }, 2, 0],
    ])("returns zero for unsafe input", (pointerVelocity, multiplier, maximumSpeed) => {
        expect(calculateReleaseVelocity(pointerVelocity, multiplier, maximumSpeed)).toEqual({
            x: 0,
            y: 0,
        });
    });

    it("keeps capped output finite when scaling enormous finite input", () => {
        const velocity = calculateReleaseVelocity(
            { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
            100,
            1200,
        );

        expect(Number.isFinite(velocity.x)).toBe(true);
        expect(Number.isFinite(velocity.y)).toBe(true);
        expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(1200);
    });
});
