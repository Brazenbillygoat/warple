import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../PhaserWrapper", () => ({
    default: () => <div>Desktop overlay route</div>,
}));

vi.mock("../../SettingWindow", () => ({
    default: () => <div>Settings route</div>,
}));

vi.mock("../../hooks/useSettings", () => ({
    useSettings: vi.fn(),
}));

vi.mock("../../hooks/usePets", () => ({
    useDefaultPets: vi.fn(),
    usePets: () => ({ isError: false, error: null }),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
    getCurrentWebviewWindow: () => ({ close: vi.fn() }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
    confirm: vi.fn(),
}));

import App from "../../App";

afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
});

describe("application routes", () => {
    it("renders the desktop overlay at the root route", async () => {
        window.history.replaceState(null, "", "/");

        render(<App />);

        expect(await screen.findByText("Desktop overlay route")).toBeDefined();
    });

    it("renders settings at the Tauri settings route", async () => {
        window.history.replaceState(null, "", "/setting?tab=3");

        render(<App />);

        expect(await screen.findByText("Settings route")).toBeDefined();
    });
});
