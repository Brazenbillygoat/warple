import { describe, expect, it, vi } from "vitest";
import { selectDefaultProfile } from "../profiles/registry";
import { bootstrapOverlay, type OverlayMountContext } from "../startup";

const search =
    "?generation=12&scaleFactor=1&monitorX=0&monitorY=0&monitorWidth=1920&monitorHeight=1080" +
    "&workAreaX=0&workAreaY=0&workAreaWidth=1920&workAreaHeight=1040";

describe("overlay startup", () => {
    it("mounts one validated profile and sends a one-shot readiness signal", () => {
        const invokeCommand = vi.fn().mockResolvedValue(undefined);
        let mounted: OverlayMountContext | undefined;

        bootstrapOverlay({
            search,
            mount: (context) => (mounted = context),
            invokeCommand,
        });

        expect(mounted?.profile.id).toBe("blooky");
        mounted?.signalReady();
        mounted?.signalReady();
        expect(invokeCommand).toHaveBeenCalledTimes(1);
        expect(invokeCommand).toHaveBeenCalledWith("startup_ready", { generation: 12 });
    });

    it("aborts without mounting when default-profile validation fails", () => {
        const invokeCommand = vi.fn().mockResolvedValue(undefined);
        const mount = vi.fn();

        bootstrapOverlay({
            search,
            mount,
            selectProfile: () => {
                const invalid = structuredClone(selectDefaultProfile()) as any;
                invalid.schemaVersion = 999;
                throw new Error("invalid default profile");
            },
            invokeCommand,
        });

        expect(mount).not.toHaveBeenCalled();
        expect(invokeCommand).toHaveBeenCalledWith("abort_startup", { generation: 12 });
    });

    it("uses the same one-shot channel for a frontend asset failure", () => {
        const invokeCommand = vi.fn().mockResolvedValue(undefined);
        let mounted: OverlayMountContext | undefined;
        bootstrapOverlay({ search, mount: (context) => (mounted = context), invokeCommand });

        mounted?.signalAbort();
        mounted?.signalReady();

        expect(invokeCommand).toHaveBeenCalledTimes(1);
        expect(invokeCommand).toHaveBeenCalledWith("abort_startup", { generation: 12 });
    });
});
