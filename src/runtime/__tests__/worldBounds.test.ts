import { describe, expect, it } from "vitest";
import { selectWorldBoundaryAction } from "../worldBounds";

const noContacts = { up: false, down: false, left: false, right: false };

describe("world-boundary action policy", () => {
    it("transitions a thrown top corner into ceiling crawl", () => {
        expect(
            selectWorldBoundaryAction(
                "jump",
                { ...noContacts, up: true, right: true },
                true,
                true,
            ),
        ).toBe("ceiling-crawl");
    });

    it("lets landing win at a bottom corner", () => {
        expect(
            selectWorldBoundaryAction(
                "jump",
                { ...noContacts, down: true, left: true },
                true,
                true,
            ),
        ).toBe("landing");
    });

    it("preserves the existing crawl-edge jump", () => {
        expect(
            selectWorldBoundaryAction(
                "crawl",
                { ...noContacts, up: true, right: true },
                true,
                true,
            ),
        ).toBe("crawl-edge-jump");
    });

    it("routes an ordinary side impact to side handling", () => {
        expect(
            selectWorldBoundaryAction(
                "jump",
                { ...noContacts, left: true },
                true,
                true,
            ),
        ).toBe("side");
    });

    it("falls from the ceiling when crawling is unavailable", () => {
        expect(
            selectWorldBoundaryAction(
                "jump",
                { ...noContacts, up: true },
                true,
                false,
            ),
        ).toBe("ceiling-fall");
    });
});
