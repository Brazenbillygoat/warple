import type { InvokeArgs } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { selectDefaultProfile } from "./profiles/registry";
import type { ValidatedCompanionProfile } from "./profiles/types";
import {
    parseOverlayGeometry,
    readStartupGeneration,
    type OverlayGeometry,
} from "./runtime/geometry";

export interface OverlayMountContext {
    readonly profile: ValidatedCompanionProfile;
    readonly geometry: OverlayGeometry;
    readonly signalReady: () => void;
    readonly signalAbort: () => void;
}

type InvokeCommand = (command: string, args?: InvokeArgs) => Promise<unknown>;

interface BootstrapOptions {
    readonly search: string;
    readonly mount: (context: OverlayMountContext) => void;
    readonly selectProfile?: () => ValidatedCompanionProfile;
    readonly invokeCommand?: InvokeCommand;
}

export function bootstrapOverlay({
    search,
    mount,
    selectProfile = selectDefaultProfile,
    invokeCommand = invoke,
}: BootstrapOptions): void {
    const fallbackGeneration = readStartupGeneration(search);
    try {
        const profile = selectProfile();
        const geometry = parseOverlayGeometry(search);
        let signaled = false;
        const signal = (command: "startup_ready" | "abort_startup") => {
            if (signaled) return;
            signaled = true;
            void invokeCommand(command, { generation: geometry.generation });
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
