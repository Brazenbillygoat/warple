import { describe, expect, it, vi } from "vitest";
import { resolveBuiltInProfiles } from "../profiles/registry";
import type { ResolvedProfiles } from "../profiles/registry";
import { bootstrapOverlay, type OverlayMountContext } from "../startup";

const search =
    "?generation=12&scaleFactor=1&monitorX=0&monitorY=0&monitorWidth=1920&monitorHeight=1080" +
    "&workAreaX=0&workAreaY=0&workAreaWidth=1920&workAreaHeight=1040";

const expectedBuiltInCatalog = [
    { id: "blooky", displayName: "Blooky" },
    { id: "jo", displayName: "Jo" },
];

function realResolver(): (requested: string | undefined) => ResolvedProfiles {
    return (requested) => resolveBuiltInProfiles(requested);
}

describe("overlay startup", () => {
    it("mounts one validated profile and sends a one-shot readiness payload", () => {
        const invokeCommand = vi.fn().mockResolvedValue(undefined);
        let mounted: OverlayMountContext | undefined;

        bootstrapOverlay({
            search,
            mount: (context) => (mounted = context),
            resolveProfiles: realResolver(),
            invokeCommand,
        });

        expect(mounted?.profile.id).toBe("blooky");
        mounted?.signalReady();
        mounted?.signalReady();
        expect(invokeCommand).toHaveBeenCalledTimes(1);
        expect(invokeCommand).toHaveBeenCalledWith("startup_ready", {
            generation: 12,
            profiles: expectedBuiltInCatalog,
            activeProfileId: "blooky",
        });
    });

    it("reads the requested profileId from the search string", () => {
        const invokeCommand = vi.fn().mockResolvedValue(undefined);
        let received: string | undefined;
        let mounted: OverlayMountContext | undefined;

        bootstrapOverlay({
            search: `${search}&profileId=blooky`,
            mount: (context) => (mounted = context),
            resolveProfiles: (requested) => {
                received = requested;
                return resolveBuiltInProfiles(requested);
            },
            invokeCommand,
        });

        expect(received).toBe("blooky");
        mounted?.signalReady();
        expect(invokeCommand).toHaveBeenCalledWith("startup_ready", {
            generation: 12,
            profiles: expectedBuiltInCatalog,
            activeProfileId: "blooky",
        });
    });

    it("treats an empty profileId as no explicit request", () => {
        let received: string | undefined;

        bootstrapOverlay({
            search: `${search}&profileId=`,
            mount: () => {},
            resolveProfiles: (requested) => {
                received = requested;
                return resolveBuiltInProfiles(requested);
            },
            invokeCommand: vi.fn(),
        });

        expect(received).toBeUndefined();
    });

    it("falls back to the validated default when the requested id is unregistered", () => {
        const invokeCommand = vi.fn().mockResolvedValue(undefined);
        let mounted: OverlayMountContext | undefined;

        bootstrapOverlay({
            search: `${search}&profileId=ghost`,
            mount: (context) => (mounted = context),
            resolveProfiles: realResolver(),
            invokeCommand,
        });

        expect(mounted?.profile.id).toBe("blooky");
        mounted?.signalReady();
        expect(invokeCommand).toHaveBeenCalledWith("startup_ready", {
            generation: 12,
            profiles: expectedBuiltInCatalog,
            activeProfileId: "blooky",
        });
    });

    it("aborts without mounting when profile resolution fails", () => {
        const invokeCommand = vi.fn().mockResolvedValue(undefined);
        const mount = vi.fn();

        bootstrapOverlay({
            search,
            mount,
            resolveProfiles: () => {
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
        bootstrapOverlay({
            search,
            mount: (context) => (mounted = context),
            resolveProfiles: realResolver(),
            invokeCommand,
        });

        mounted?.signalAbort();
        mounted?.signalReady();

        expect(invokeCommand).toHaveBeenCalledTimes(1);
        expect(invokeCommand).toHaveBeenCalledWith("abort_startup", { generation: 12 });
    });

    it("mounts the shipped Jo profile and sends its validated catalog identity", () => {
        const invokeCommand = vi.fn().mockResolvedValue(undefined);
        let mounted: OverlayMountContext | undefined;
        bootstrapOverlay({
            search: `${search}&profileId=jo`,
            mount: (context) => (mounted = context),
            resolveProfiles: realResolver(),
            invokeCommand,
        });

        expect(mounted?.profile.id).toBe("jo");
        mounted?.signalReady();
        expect(invokeCommand).toHaveBeenCalledWith("startup_ready", {
            generation: 12,
            profiles: expectedBuiltInCatalog,
            activeProfileId: "jo",
        });
    });
});
