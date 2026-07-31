import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import About from "../../ui/setting_tabs/About";
import i18next from "../../i18next";
import English from "../../locale/en/translation.json";
import Khmer from "../../locale/kh/translation.json";
import SimplifiedChinese from "../../locale/zh-CN/translation.json";
import TraditionalChinese from "../../locale/zh-TW/translation.json";

const { openUrl } = vi.hoisted(() => ({
    openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
    getVersion: vi.fn().mockResolvedValue("0.0.9"),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
    openUrl,
}));

afterEach(() => {
    cleanup();
    openUrl.mockClear();
});

function renderAbout() {
    return render(
        <I18nextProvider i18n={i18next}>
            <MantineProvider>
                <About />
            </MantineProvider>
        </I18nextProvider>
    );
}

describe("About", () => {
    it("shows Warple identity, a plain version, and only the approved project links", async () => {
        renderAbout();

        expect(screen.getByText("Warple")).toBeDefined();
        expect(await screen.findByText("Version 0.0.9")).toBeDefined();
        expect(screen.queryByText("(release note)")).toBeNull();
        expect(screen.queryByText("Report a bug:")).toBeNull();
        expect(screen.queryByText("Community:")).toBeNull();
        expect(screen.queryByText("Buy me a coffee:")).toBeNull();

        fireEvent.click(screen.getByText("Brazenbillygoat/warple"));
        fireEvent.click(screen.getByText("SeakMengs/WindowPet"));

        expect(openUrl.mock.calls).toEqual([
            ["https://github.com/Brazenbillygoat/warple"],
            ["https://github.com/SeakMengs/WindowPet"],
        ]);
    });

    it("ships no legacy current-product branding in translations", () => {
        for (const translation of [English, Khmer, SimplifiedChinese, TraditionalChinese]) {
            expect(JSON.stringify(translation)).not.toContain("WindowPet");
        }
    });
});
