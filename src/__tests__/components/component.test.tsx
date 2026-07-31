import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, useLocation } from "react-router";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SettingWindow from "../../SettingWindow";
import i18next from "../../i18next";
import { useSettingTabStore } from "../../hooks/useSettingTabStore";
import { ESettingTab } from "../../types/ISetting";

vi.mock("../../ui/components/PhaserCanvas", () => ({
    default: () => null,
}));

vi.mock("../../hooks/usePets", () => ({
    usePets: () => ({ data: [], refetch: vi.fn() }),
    useDefaultPets: () => ({ data: [], refetch: vi.fn() }),
}));

vi.mock("../../ui/setting_tabs/PetShop", () => ({
    default: () => <div>Pet shop tab content</div>,
}));

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    useSettingTabStore.setState({ activeTab: ESettingTab.MyPets });
});

function LocationSearch() {
    return <output data-testid="location-search">{useLocation().search}</output>;
}

function renderSettingWindow(initialEntry = "/setting") {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <I18nextProvider i18n={i18next}>
                <MemoryRouter initialEntries={[initialEntry]}>
                    <MantineProvider>
                        <SettingWindow />
                    </MantineProvider>
                    <LocationSearch />
                </MemoryRouter>
            </I18nextProvider>
        </QueryClientProvider>
    );
}

describe("SettingWindow", () => {
    it("should be defined", () => {
        renderSettingWindow();

        expect(screen).toBeDefined();
    });

    it("selects the settings tab from the query string", async () => {
        renderSettingWindow("/setting?tab=1");

        expect(await screen.findByText("Pet shop tab content")).toBeDefined();
        expect(useSettingTabStore.getState().activeTab).toBe(ESettingTab.PetShop);
    });

    it("writes the selected settings tab to the query string", async () => {
        renderSettingWindow();

        fireEvent.click(screen.getAllByRole("button")[1]);

        await waitFor(() => {
            expect(screen.getByTestId("location-search").textContent).toBe("?tab=1");
        });
        expect(useSettingTabStore.getState().activeTab).toBe(ESettingTab.PetShop);
    });
});
