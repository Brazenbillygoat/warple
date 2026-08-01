import { invoke } from "@tauri-apps/api/core";
import { error } from "@tauri-apps/plugin-log";
import {
    validateDesktopEnvironmentResponse,
    validateDesktopItemDetails,
    type DesktopEnvironmentSnapshot,
    type DesktopItemDetails,
} from "../runtime/desktopEnvironment";
import type { OverlayGeometry } from "../runtime/geometry";
import {
    type DesktopEnvironmentDiagnosticsRecorder,
} from "./desktopEnvironmentDiagnostics";

export const DESKTOP_OBSERVATION_TUNING = Object.freeze({
    pollIntervalMs: 250,
    staleAfterMs: 1000,
});

const MAX_DETAIL_CACHE_ENTRIES = 2_048;

export class DesktopEnvironmentManager {
    private diagnostics: DesktopEnvironmentDiagnosticsRecorder | undefined;
    private requestInFlight = false;
    private lastPollAt = Number.NEGATIVE_INFINITY;
    private latestSnapshot: DesktopEnvironmentSnapshot | undefined;
    private latestReceivedAt = Number.NEGATIVE_INFINITY;
    private latestSequence = 0;
    private readonly attemptedDetails = new Set<string>();
    private readonly detailsByItemId = new Map<string, DesktopItemDetails>();

    constructor(private readonly geometry: OverlayGeometry) {
        if (import.meta.env.DEV) {
            void import("./desktopEnvironmentDiagnostics").then(
                ({ DesktopEnvironmentDiagnosticsRecorder, installDesktopEnvironmentDiagnostics }) => {
                    this.diagnostics = new DesktopEnvironmentDiagnosticsRecorder();
                    installDesktopEnvironmentDiagnostics(this.diagnostics.view);
                },
            );
        }
    }

    public poll(nowMs: number): void {
        if (!Number.isFinite(nowMs) || this.requestInFlight) return;
        if (nowMs < this.lastPollAt) this.lastPollAt = Number.NEGATIVE_INFINITY;
        if (nowMs - this.lastPollAt < DESKTOP_OBSERVATION_TUNING.pollIntervalMs) return;

        this.lastPollAt = nowMs;
        this.requestInFlight = true;
        const diagnosticsRequest = this.diagnostics?.beginEnvironmentRequest();
        void invoke<unknown>("get_desktop_environment")
            .then((response) => {
                const snapshot = validateDesktopEnvironmentResponse(response, this.geometry);
                if (diagnosticsRequest !== undefined) {
                    this.diagnostics?.completeEnvironmentRequest(
                        diagnosticsRequest,
                        response,
                        snapshot,
                    );
                }
                if (!snapshot) {
                    this.latestSnapshot = undefined;
                    return;
                }
                if (snapshot.sequence <= this.latestSequence) return;
                this.latestSequence = snapshot.sequence;
                this.latestSnapshot = snapshot;
                this.latestReceivedAt = nowMs;
                if (this.diagnostics && snapshot.desktopShellActive) {
                    const selectedItem =
                        snapshot.desktopItems.find((item) => item.selected && item.focused) ??
                        snapshot.desktopItems.find((item) => item.selected);
                    if (selectedItem) this.requestDetails(selectedItem.id);
                }
            })
            .catch(() => {
                if (diagnosticsRequest !== undefined) {
                    this.diagnostics?.failEnvironmentRequest(diagnosticsRequest);
                }
                this.latestSnapshot = undefined;
                error("Failed to observe the Windows desktop environment");
            })
            .finally(() => {
                this.requestInFlight = false;
            });
    }

    public getLatestSnapshot(nowMs: number): DesktopEnvironmentSnapshot | undefined {
        if (
            !this.latestSnapshot ||
            !Number.isFinite(nowMs) ||
            nowMs < this.latestReceivedAt ||
            nowMs - this.latestReceivedAt > DESKTOP_OBSERVATION_TUNING.staleAfterMs
        ) {
            return undefined;
        }
        return this.latestSnapshot;
    }

    public requestDetails(itemId: string): void {
        if (
            this.attemptedDetails.has(itemId) ||
            this.attemptedDetails.size >= MAX_DETAIL_CACHE_ENTRIES ||
            !this.latestSnapshot?.desktopItems.some((item) => item.id === itemId)
        ) {
            return;
        }
        this.attemptedDetails.add(itemId);
        const diagnosticsRequest = this.diagnostics?.beginDetailsRequest(itemId);
        void invoke<unknown>("get_desktop_item_details", { itemId })
            .then((response) => {
                const details = validateDesktopItemDetails(response, itemId);
                if (diagnosticsRequest !== undefined) {
                    this.diagnostics?.completeDetailsRequest(
                        diagnosticsRequest,
                        response,
                        details,
                    );
                }
                if (details) this.detailsByItemId.set(itemId, details);
            })
            .catch(() => {
                if (diagnosticsRequest !== undefined) {
                    this.diagnostics?.failDetailsRequest(diagnosticsRequest);
                }
                error("Failed to read desktop item details");
            });
    }

    public getDetails(itemId: string): DesktopItemDetails | undefined {
        return this.detailsByItemId.get(itemId);
    }
}
