import { describe, expect, it } from "vitest";
import { selectWeightedOrdinaryRole } from "../weightedState";

const weights = { stand: 50, sit: 35, walk: 12, greet: 3, idle: 0, special: 2 } as const;

describe("weighted ordinary state policy", () => {
    it.each([
        [0, "stand"],
        [0.49, "stand"],
        [0.5, "sit"],
        [0.83, "sit"],
        [0.84, "walk"],
        [0.95, "walk"],
        [0.951, "greet"],
        [0.98, "greet"],
        [0.981, "special"],
        [0.999_999, "special"],
    ] as const)("maps %s to %s", (randomValue, expected) => {
        expect(selectWeightedOrdinaryRole(weights, randomValue)).toBe(expected);
    });

    it("gives special approximately 1.96 percent beside the unchanged weights", () => {
        const total = Object.values(weights).reduce<number>((sum, value) => sum + value, 0);
        expect(total).toBe(102);
        expect(weights.special / total).toBeCloseTo(0.0196, 2);
    });

    it("never selects a zero-weight special role", () => {
        const blookyWeights = { stand: 50, sit: 35, walk: 12, greet: 3, idle: 0, special: 0 } as const;
        expect(selectWeightedOrdinaryRole(blookyWeights, 0)).toBe("stand");
        expect(selectWeightedOrdinaryRole(blookyWeights, 0.5)).toBe("sit");
        expect(selectWeightedOrdinaryRole(blookyWeights, 0.85)).toBe("walk");
        expect(selectWeightedOrdinaryRole(blookyWeights, 0.97)).toBe("greet");
        expect(selectWeightedOrdinaryRole(blookyWeights, 0.999_999)).toBe("greet");
    });

    it("rejects invalid random input", () => {
        expect(() => selectWeightedOrdinaryRole(weights, 1)).toThrow(RangeError);
        expect(() => selectWeightedOrdinaryRole(weights, Number.NaN)).toThrow(RangeError);
    });
});

describe("Jo ordinary weights", () => {
    const joWeights = { stand: 45, sit: 31, walk: 11, greet: 3, idle: 8, special: 2 } as const;

    it("totals exactly 100 with the authored distribution and idle before special", () => {
        const total = Object.values(joWeights).reduce<number>((sum, value) => sum + value, 0);
        expect(total).toBe(100);
        expect(joWeights).toEqual({ stand: 45, sit: 31, walk: 11, greet: 3, idle: 8, special: 2 });
    });

    it.each([
        [0, "stand"],
        [0.44, "stand"],
        [0.45, "sit"],
        [0.75, "sit"],
        [0.76, "walk"],
        [0.86, "walk"],
        [0.87, "greet"],
        [0.89, "greet"],
        [0.90, "idle"],
        [0.97, "idle"],
        [0.98, "special"],
        [0.999, "special"],
    ] as const)("maps %s to %s for Jo", (randomValue, expected) => {
        expect(selectWeightedOrdinaryRole(joWeights, randomValue)).toBe(expected);
    });

    it("keeps MJ-spin as the 2 percent special role", () => {
        expect(joWeights.special).toBe(2);
        expect(joWeights.special / 100).toBeCloseTo(0.02);
    });
});
