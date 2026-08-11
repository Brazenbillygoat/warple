import type { InvokeArgs } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { resolveBuiltInProfiles, type ResolvedProfiles } from "./profiles/registry";
import type { ProfileCatalogEntry, ValidatedCompanionProfile } from "./profiles/types";
import {
    parseOverlayGeometry,
    readStartupGeneration,
    type OverlayGeometry,
} from "./runtime/geometry";

const PROFILE_ID_PARAMETER = "profileId";

export interface OverlayMountContext {
    readonly profile: ValidatedCompanionProfile;
    readonly geometry: OverlayGeometry;
    readonly signalReady: () => void;
    readonly signalAbort: () => void;
}

type InvokeCommand = (command: string, args?: InvokeArgs) => Promise<unknown>;
type ProfileResolver = (requestedProfileId: string | undefined) => ResolvedProfiles;

interface BootstrapOptions {
    readonly search: string;
    readonly mount: (context: OverlayMountContext) => void;
    readonly resolveProfiles?: ProfileResolver;
    readonly invokeCommand?: InvokeCommand;
}

export function bootstrapOverlay({
    search,
    mount,
    resolveProfiles = resolveBuiltInProfiles,
    invokeCommand = invoke,
}: BootstrapOptions): void {
    const fallbackGeneration = readStartupGeneration(search);
    try {
        const requestedProfileId = readRequestedProfileId(search);
        const geometry = parseOverlayGeometry(geometrySearch(search));
        const { profile, catalog } = resolveProfiles(requestedProfileId);
        let signaled = false;
        const signal = (command: "startup_ready" | "abort_startup") => {
            if (signaled) return;
            signaled = true;
            void invokeCommand(command, buildPayload(command, geometry.generation, profile, catalog));
        };

        mount({
            profile,
            geometry,
            signalReady: () => signal("startup_ready"),
            signalAbort: () => signal("abort_startup"),
        });
    } catch {
        void invokeCommand("abort_startup", { generation: fallbackGeneration });
    }
}

function readRequestedProfileId(search: string): string | undefined {
    const raw = new URLSearchParams(search).get(PROFILE_ID_PARAMETER);
    if (raw === null) return undefined;
    const trimmed = raw.trim();
    return trimmed === "" ? undefined : trimmed;
}

function geometrySearch(search: string): string {
    const params = new URLSearchParams(search);
    params.delete(PROFILE_ID_PARAMETER);
    return params.toString();
}

function buildPayload(
    command: "startup_ready" | "abort_startup",
    generation: number,
    profile: ValidatedCompanionProfile,
    catalog: readonly ProfileCatalogEntry[],
): InvokeArgs {
    if (command === "abort_startup") {
        return { generation };
    }
    return {
        generation,
        profiles: catalog.map((entry) => ({ id: entry.id, displayName: entry.displayName })),
        activeProfileId: profile.id,
    };
}
