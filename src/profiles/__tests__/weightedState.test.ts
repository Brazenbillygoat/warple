import { describe, expect, it } from "vitest";
import { selectWeightedOrdinaryRole } from "../weightedState";

const weights = { stand: 50, sit: 35, walk: 12, greet: 3 } as const;

describe("weighted ordinary state policy", () => {
    it.each([
        [0, "stand"],
        [0.499_999, "stand"],
        [0.5, "sit"],
        [0.849_999, "sit"],
        [0.85, "walk"],
        [0.969_999, "walk"],
        [0.97, "greet"],
        [0.999_999, "greet"],
    ] as const)("maps %s to %s", (randomValue, expected) => {
        expect(selectWeightedOrdinaryRole(weights, randomValue)).toBe(expected);
    });

    it("rejects invalid random input", () => {
        expect(() => selectWeightedOrdinaryRole(weights, 1)).toThrow(RangeError);
        expect(() => selectWeightedOrdinaryRole(weights, Number.NaN)).toThrow(RangeError);
    });
});
