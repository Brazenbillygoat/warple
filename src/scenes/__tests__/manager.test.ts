import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayGeometry } from "../../runtime/geometry";
import { BLOOKY_PROFILE } from "../../profiles/blooky";
import { JO_PROFILE } from "../../profiles/jo";
import { validateCompanionProfile } from "../../profiles/validator";

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    setIgnoreCursorEvents: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
    getCurrentWebviewWindow: () => ({ setIgnoreCursorEvents: mocks.setIgnoreCursorEvents }),
}));
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn(), info: vi.fn() }));

import { ConfigManager, InputManager } from "../manager";

const geometry: OverlayGeometry = {
    generation: 1,
    scaleFactor: 2,
    monitor: { x: -100, y: 0, width: 800, height: 600 },
    workArea: { x: 0, y: 20, width: 800, height: 560 },
};

function inputManagerStub(hit = false) {
    return {
        mousePointer: { x: 0, y: 0 },
        activePointer: {},
        hitTestPointer: vi.fn(() => (hit ? [{}] : [])),
    };
}

describe("InputManager cursor snapshots", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("retains a finite overlay-local cursor inside the work area", async () => {
        mocks.invoke.mockResolvedValue({ clientX: 200, clientY: 200 });
        const manager = new InputManager(geometry);
        const input = inputManagerStub();
        manager.setInputManager(input as never);

        manager.checkIsMouseOverPet();
        await vi.waitFor(() => expect(manager.getLatestCursorSnapshot()).toBeDefined());

        expect(manager.getLatestCursorSnapshot()).toEqual({ x: 200, y: 100 });
        expect(input.mousePointer).toEqual({ x: 200, y: 100 });
        expect(input.hitTestPointer).toHaveBeenCalledOnce();
    });

    it.each([
        ["outside work area", { clientX: 2000, clientY: 200 }],
        ["non-finite", { clientX: Number.NaN, clientY: 200 }],
        ["missing", null],
    ])("does not expose an %s snapshot", async (_label, nativePosition) => {
        mocks.invoke.mockResolvedValue(nativePosition);
        const manager = new InputManager(geometry);
        manager.setInputManager(inputManagerStub() as never);

        manager.checkIsMouseOverPet();
        await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
        await Promise.resolve();

        expect(manager.getLatestCursorSnapshot()).toBeUndefined();
    });

    it("allows only one native cursor request at a time", async () => {
        let resolveRequest: ((value: { clientX: number; clientY: number }) => void) | undefined;
        mocks.invoke.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRequest = resolve;
                }),
        );
        const manager = new InputManager(geometry);
        manager.setInputManager(inputManagerStub() as never);

        manager.checkIsMouseOverPet();
        manager.checkIsMouseOverPet();
        expect(mocks.invoke).toHaveBeenCalledOnce();

        resolveRequest?.({ clientX: 200, clientY: 200 });
        await vi.waitFor(() => expect(manager.getLatestCursorSnapshot()).toBeDefined());
        manager.checkIsMouseOverPet();
        expect(mocks.invoke).toHaveBeenCalledTimes(2);
    });
});

describe("ConfigManager optional animation roles", () => {
    it("resolves Jo's transition and hold animation keys", () => {
        const manager = new ConfigManager(validateCompanionProfile(JO_PROFILE));
        expect(manager.getOptionalAnimationKey("sit-down")).toBe("sit-down-jo");
        expect(manager.getOptionalAnimationKey("stand-up")).toBe("stand-up-jo");
        expect(manager.getOptionalAnimationKey("crawl-hold")).toBe("crawl-hold-jo");
        expect(manager.getOptionalAnimationKey("climb-hold")).toBe("climb-hold-jo");
    });

    it("resolves Jo's idle and special engine-role keys", () => {
        const manager = new ConfigManager(validateCompanionProfile(JO_PROFILE));
        expect(manager.getAnimationKeyForRole("idle")).toBe("front-idle-jo");
        expect(manager.getAnimationKeyForRole("special")).toBe("mj-spin-jo");
    });

    it("returns undefined for every optional role when the profile supplies none (Blooky)", () => {
        const manager = new ConfigManager(validateCompanionProfile(BLOOKY_PROFILE));
        expect(manager.getOptionalAnimationKey("sit-down")).toBeUndefined();
        expect(manager.getOptionalAnimationKey("stand-up")).toBeUndefined();
        expect(manager.getOptionalAnimationKey("crawl-hold")).toBeUndefined();
        expect(manager.getOptionalAnimationKey("climb-hold")).toBeUndefined();
        expect(manager.getAnimationKeyForRole("idle")).toBe("stand-blooky");
    });
});
