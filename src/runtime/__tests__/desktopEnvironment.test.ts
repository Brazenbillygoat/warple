import { describe, expect, it } from "vitest";
import type { OverlayGeometry } from "../geometry";
import {
    validateDesktopEnvironmentResponse,
    validateDesktopItemDetails,
} from "../desktopEnvironment";

const geometry: OverlayGeometry = {
    generation: 1,
    scaleFactor: 2,
    monitor: { x: -100, y: -50, width: 1000, height: 700 },
    workArea: { x: 0, y: 20, width: 1000, height: 650 },
};

function nativeItem(overrides: Record<string, unknown> = {}) {
    return {
        id: "desktop-item-1",
        displayName: "This PC",
        editingName: "This PC",
        position: { x: -160, y: -20 },
        bounds: { x: -160, y: -20, width: 128, height: 160 },
        selected: true,
        focused: true,
        sourceOrder: 0,
        shellKinds: ["folder"],
        fileSystemPath: null,
        parsingPath: "::{virtual}",
        shortcut: null,
        attributes: {
            fileSystem: false,
            folder: true,
            shortcut: false,
            hidden: false,
            readOnly: false,
            shared: false,
            copyable: false,
            movable: false,
            linkable: true,
        },
        ...overrides,
    };
}

function response(overrides: Record<string, unknown> = {}) {
    return {
        available: true,
        sequence: 7,
        foregroundWindow: {
            id: "window-1",
            bounds: { x: -240, y: -60, width: 800, height: 600 },
        },
        desktopShellActive: true,
        desktopItems: [nativeItem()],
        ...overrides,
    };
}

describe("desktop environment validation", () => {
    it("normalizes negative physical origins and scale exactly once", () => {
        const snapshot = validateDesktopEnvironmentResponse(response(), geometry);

        expect(snapshot?.foregroundWindow?.bounds).toEqual({
            x: 0,
            y: 20,
            width: 380,
            height: 300,
        });
        expect(snapshot?.desktopItems[0]?.position).toEqual({ x: 20, y: 40 });
        expect(snapshot?.desktopItems[0]?.bounds).toEqual({
            x: 20,
            y: 40,
            width: 64,
            height: 80,
        });
    });

    it("preserves virtual desktop items without filesystem paths", () => {
        const item = validateDesktopEnvironmentResponse(response(), geometry)?.desktopItems[0];
        expect(item?.fileSystemPath).toBeUndefined();
        expect(item?.parsingPath).toBe("::{virtual}");
    });

    it("filters items outside the usable work area", () => {
        const snapshot = validateDesktopEnvironmentResponse(
            response({
                desktopItems: [
                    nativeItem({
                        position: { x: 10_000, y: 10_000 },
                        bounds: { x: 10_000, y: 10_000, width: 100, height: 100 },
                    }),
                ],
            }),
            geometry,
        );
        expect(snapshot?.desktopItems).toEqual([]);
    });

    it.each([
        ["unavailable", response({ available: false })],
        ["invalid sequence", response({ sequence: Number.NaN })],
        ["invalid window geometry", response({ foregroundWindow: { id: "window", bounds: { x: 0, y: 0, width: -1, height: 20 } } })],
        ["invalid icon geometry", response({ desktopItems: [nativeItem({ bounds: { x: 0, y: 0, width: Infinity, height: 20 } })] })],
    ])("treats an %s response as unavailable", (_label, candidate) => {
        expect(validateDesktopEnvironmentResponse(candidate, geometry)).toBeUndefined();
    });

    it("validates finite serializable detail properties", () => {
        expect(
            validateDesktopItemDetails(
                {
                    itemId: "desktop-item-1",
                    properties: [
                        { canonicalName: "System.Size", value: 42, formattedValue: "42 bytes" },
                        { canonicalName: "System.Keywords", value: ["one", "two"] },
                    ],
                },
                "desktop-item-1",
            ),
        ).toEqual({
            itemId: "desktop-item-1",
            properties: [
                { canonicalName: "System.Size", value: 42, formattedValue: "42 bytes" },
                { canonicalName: "System.Keywords", value: ["one", "two"] },
            ],
        });
        expect(
            validateDesktopItemDetails(
                { itemId: "desktop-item-1", properties: [{ canonicalName: "bad", value: Infinity }] },
                "desktop-item-1",
            ),
        ).toBeUndefined();
    });
});
