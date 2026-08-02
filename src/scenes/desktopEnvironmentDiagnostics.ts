import type {
    DesktopEnvironmentSnapshot,
    DesktopItemDetails,
} from "../runtime/desktopEnvironment";

export type DesktopDiagnosticStatus = "pending" | "valid" | "invalid" | "failed";

export interface DesktopDiagnosticExchange<T> {
    readonly requestNumber: number;
    readonly command: "get_desktop_environment" | "get_desktop_item_details";
    readonly arguments?: Readonly<{ itemId: string }>;
    readonly status: DesktopDiagnosticStatus;
    readonly rawResponse?: unknown;
    readonly validatedResponse?: T;
}

export interface DesktopEnvironmentDiagnostics {
    readonly latestEnvironment?: DesktopDiagnosticExchange<DesktopEnvironmentSnapshot>;
    readonly latestActiveEnvironment?: DesktopDiagnosticExchange<DesktopEnvironmentSnapshot>;
    readonly latestDetails?: DesktopDiagnosticExchange<DesktopItemDetails>;
}

export const DESKTOP_DIAGNOSTICS_GLOBAL = "warpleDesktopDiagnostics";

export class DesktopEnvironmentDiagnosticsRecorder {
    private environmentRequestNumber = 0;
    private detailsRequestNumber = 0;
    private latestEnvironmentValue: DesktopDiagnosticExchange<DesktopEnvironmentSnapshot> | undefined;
    private latestActiveEnvironmentValue: DesktopDiagnosticExchange<DesktopEnvironmentSnapshot> | undefined;
    private latestDetailsValue: DesktopDiagnosticExchange<DesktopItemDetails> | undefined;

    public readonly view: DesktopEnvironmentDiagnostics;

    constructor() {
        const thisRecorder = this;
        this.view = Object.freeze({
            get latestEnvironment() {
                return thisRecorder.latestEnvironmentValue;
            },
            get latestActiveEnvironment() {
                return thisRecorder.latestActiveEnvironmentValue;
            },
            get latestDetails() {
                return thisRecorder.latestDetailsValue;
            },
        });
    }

    public beginEnvironmentRequest(): number {
        const requestNumber = ++this.environmentRequestNumber;
        this.latestEnvironmentValue = Object.freeze({
            requestNumber,
            command: "get_desktop_environment",
            status: "pending",
        });
        return requestNumber;
    }

    public completeEnvironmentRequest(
        requestNumber: number,
        rawResponse: unknown,
        validatedResponse: DesktopEnvironmentSnapshot | undefined,
    ): void {
        if (this.latestEnvironmentValue?.requestNumber !== requestNumber) return;
        const exchange: DesktopDiagnosticExchange<DesktopEnvironmentSnapshot> = Object.freeze({
            requestNumber,
            command: "get_desktop_environment",
            status: validatedResponse ? "valid" : "invalid",
            rawResponse,
            validatedResponse,
        });
        this.latestEnvironmentValue = exchange;
        if (validatedResponse?.desktopShellActive) this.latestActiveEnvironmentValue = exchange;
    }

    public failEnvironmentRequest(requestNumber: number): void {
        if (this.latestEnvironmentValue?.requestNumber !== requestNumber) return;
        this.latestEnvironmentValue = Object.freeze({
            requestNumber,
            command: "get_desktop_environment",
            status: "failed",
        });
    }

    public beginDetailsRequest(itemId: string): number {
        const requestNumber = ++this.detailsRequestNumber;
        this.latestDetailsValue = Object.freeze({
            requestNumber,
            command: "get_desktop_item_details",
            arguments: Object.freeze({ itemId }),
            status: "pending",
        });
        return requestNumber;
    }

    public completeDetailsRequest(
        requestNumber: number,
        rawResponse: unknown,
        validatedResponse: DesktopItemDetails | undefined,
    ): void {
        if (this.latestDetailsValue?.requestNumber !== requestNumber) return;
        this.latestDetailsValue = Object.freeze({
            requestNumber,
            command: "get_desktop_item_details",
            arguments: this.latestDetailsValue.arguments,
            status: validatedResponse ? "valid" : "invalid",
            rawResponse,
            validatedResponse,
        });
    }

    public failDetailsRequest(requestNumber: number): void {
        if (this.latestDetailsValue?.requestNumber !== requestNumber) return;
        this.latestDetailsValue = Object.freeze({
            requestNumber,
            command: "get_desktop_item_details",
            arguments: this.latestDetailsValue.arguments,
            status: "failed",
        });
    }
}

export function installDesktopEnvironmentDiagnostics(
    diagnostics: DesktopEnvironmentDiagnostics,
): void {
    Object.defineProperty(globalThis, DESKTOP_DIAGNOSTICS_GLOBAL, {
        configurable: true,
        enumerable: true,
        value: diagnostics,
    });
}
