import { describe, expect, it } from "vitest";
import { parseOverlayGeometry } from "../geometry";
import { getSpriteCentersInsideBounds } from "../worldBounds";

const search =
    "?generation=7&scaleFactor=1.5&monitorX=-1280&monitorY=0&monitorWidth=1280&monitorHeight=720" +
    "&workAreaX=40&workAreaY=24&workAreaWidth=1200&workAreaHeight=656";

describe("overlay geometry", () => {
    it("parses explicit normalized monitor and work-area inputs", () => {
        expect(parseOverlayGeometry(search)).toEqual({
            generation: 7,
            scaleFactor: 1.5,
            monitor: { x: -1280, y: 0, width: 1280, height: 720 },
            workArea: { x: 40, y: 24, width: 1200, height: 656 },
        });
    });

    it("rejects a work area outside its monitor", () => {
        expect(() =>
            parseOverlayGeometry(search.replace("workAreaWidth=1200", "workAreaWidth=1300")),
        ).toThrow("inside the monitor");
    });

    it("constrains all four sprite edges to the entire usable work area", () => {
        const bounds = parseOverlayGeometry(search).workArea;
        const centers = getSpriteCentersInsideBounds(bounds, {
            width: 128,
            height: 128,
            scaleX: -0.7,
            scaleY: 0.7,
            originX: 0.5,
            originY: 0.5,
        });

        expect(centers).toEqual({ left: 84.8, right: 1195.2, top: 68.8, bottom: 635.2 });
        expect(centers.left - 44.8).toBeCloseTo(bounds.x);
        expect(centers.right + 44.8).toBeCloseTo(bounds.x + bounds.width);
        expect(centers.top - 44.8).toBeCloseTo(bounds.y);
        expect(centers.bottom + 44.8).toBeCloseTo(bounds.y + bounds.height);
    });
});
