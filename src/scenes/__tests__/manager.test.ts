import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayGeometry } from "../../runtime/geometry";

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    setIgnoreCursorEvents: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
    getCurrentWebviewWindow: () => ({ setIgnoreCursorEvents: mocks.setIgnoreCursorEvents }),
}));
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn() }));

import { InputManager } from "../manager";

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
