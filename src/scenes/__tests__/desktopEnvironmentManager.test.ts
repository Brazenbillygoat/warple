import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayGeometry } from "../../runtime/geometry";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-log", () => ({ error: mocks.error }));

import {
    DESKTOP_OBSERVATION_TUNING,
    DesktopEnvironmentManager,
} from "../desktopEnvironmentManager";
import type { DesktopEnvironmentDiagnostics } from "../desktopEnvironmentDiagnostics";

const geometry: OverlayGeometry = {
    generation: 1,
    scaleFactor: 1,
    monitor: { x: 0, y: 0, width: 1000, height: 700 },
    workArea: { x: 0, y: 0, width: 1000, height: 680 },
};

function item(id = "item-one") {
    return {
        id,
        displayName: "fixture",
        editingName: "fixture",
        position: { x: 100, y: 500 },
        bounds: { x: 100, y: 500, width: 64, height: 80 },
        selected: false,
        focused: false,
        sourceOrder: 0,
        shellKinds: ["item"],
        fileSystemPath: null,
        parsingPath: "shell:fixture",
        shortcut: null,
        attributes: {
            fileSystem: false,
            folder: false,
            shortcut: false,
            hidden: false,
            readOnly: false,
            shared: false,
            copyable: true,
            movable: true,
            linkable: true,
        },
    };
}

function snapshot(sequence: number, items = [item()]) {
    return {
        available: true,
        sequence,
        foregroundWindow: null,
        desktopShellActive: true,
        desktopItems: items,
    };
}

function diagnostics(): DesktopEnvironmentDiagnostics | undefined {
    return (
        globalThis as typeof globalThis & {
            warpleDesktopDiagnostics?: DesktopEnvironmentDiagnostics;
        }
    ).warpleDesktopDiagnostics;
}

describe("DesktopEnvironmentManager", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete (
            globalThis as typeof globalThis & {
                warpleDesktopDiagnostics?: DesktopEnvironmentDiagnostics;
            }
        ).warpleDesktopDiagnostics;
    });

    it("polls at four hertz and prevents overlapping requests", async () => {
        let resolveRequest: ((value: unknown) => void) | undefined;
        mocks.invoke.mockImplementation(
            () => new Promise((resolve) => (resolveRequest = resolve)),
        );
        const manager = new DesktopEnvironmentManager(geometry);

        manager.poll(0);
        manager.poll(100);
        manager.poll(300);
        expect(mocks.invoke).toHaveBeenCalledOnce();

        resolveRequest?.(snapshot(1));
        await vi.waitFor(() => expect(manager.getLatestSnapshot(300)).toBeDefined());
        manager.poll(301);
        expect(mocks.invoke).toHaveBeenCalledTimes(2);
    });

    it("ignores obsolete sequences and clears invalid responses", async () => {
        mocks.invoke.mockResolvedValueOnce(snapshot(2));
        const manager = new DesktopEnvironmentManager(geometry);
        manager.poll(0);
        await vi.waitFor(() => expect(manager.getLatestSnapshot(0)?.sequence).toBe(2));

        mocks.invoke.mockResolvedValueOnce(snapshot(1));
        manager.poll(250);
        await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        expect(manager.getLatestSnapshot(250)?.sequence).toBe(2);

        mocks.invoke.mockResolvedValueOnce({ available: true, sequence: Number.NaN });
        manager.poll(500);
        await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(3));
        await Promise.resolve();
        expect(manager.getLatestSnapshot(500)).toBeUndefined();
    });

    it("marks observations stale by elapsed time", async () => {
        mocks.invoke.mockResolvedValue(snapshot(1));
        const manager = new DesktopEnvironmentManager(geometry);
        manager.poll(100);
        await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        expect(manager.getLatestSnapshot(100)).toBeDefined();
        expect(manager.getLatestSnapshot(100 + DESKTOP_OBSERVATION_TUNING.staleAfterMs)).toBeDefined();
        expect(manager.getLatestSnapshot(101 + DESKTOP_OBSERVATION_TUNING.staleAfterMs)).toBeUndefined();
    });

    it("deduplicates detail requests and caches successful details without blocking snapshots", async () => {
        mocks.invoke.mockResolvedValueOnce(snapshot(1));
        const manager = new DesktopEnvironmentManager(geometry);
        manager.poll(0);
        await vi.waitFor(() => expect(manager.getLatestSnapshot(0)).toBeDefined());

        let resolveDetails: ((value: unknown) => void) | undefined;
        mocks.invoke.mockImplementationOnce(
            () => new Promise((resolve) => (resolveDetails = resolve)),
        );
        manager.requestDetails("item-one");
        manager.requestDetails("item-one");
        manager.requestDetails("unknown");
        expect(mocks.invoke).toHaveBeenCalledTimes(2);
        expect(manager.getLatestSnapshot(0)).toBeDefined();

        resolveDetails?.({ itemId: "item-one", properties: [{ canonicalName: "System.Size", value: 42 }] });
        await vi.waitFor(() => expect(manager.getDetails("item-one")).toBeDefined());
        expect(manager.getDetails("item-one")?.properties[0]?.value).toBe(42);
    });

    it("exposes live environment and selected-item detail exchanges only in memory", async () => {
        const selectedItem = { ...item(), selected: true, focused: true };
        const rawEnvironment = snapshot(7, [selectedItem]);
        const rawDetails = {
            itemId: "item-one",
            properties: [{ canonicalName: "System.Size", value: 42 }],
        };
        mocks.invoke.mockResolvedValueOnce(rawEnvironment).mockResolvedValueOnce(rawDetails);

        const manager = new DesktopEnvironmentManager(geometry);
        await vi.waitFor(() => expect(diagnostics()).toBeDefined());
        manager.poll(0);

        await vi.waitFor(() => expect(diagnostics()?.latestDetails?.status).toBe("valid"));
        expect(diagnostics()?.latestActiveEnvironment).toMatchObject({
            command: "get_desktop_environment",
            status: "valid",
            rawResponse: rawEnvironment,
            validatedResponse: { sequence: 7, desktopShellActive: true },
        });
        expect(diagnostics()?.latestDetails).toMatchObject({
            command: "get_desktop_item_details",
            arguments: { itemId: "item-one" },
            status: "valid",
            rawResponse: rawDetails,
            validatedResponse: { itemId: "item-one" },
        });
        expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_desktop_environment");
        expect(mocks.invoke).toHaveBeenNthCalledWith(2, "get_desktop_item_details", {
            itemId: "item-one",
        });
    });
});
