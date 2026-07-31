import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SettingWindow from "../../SettingWindow";
import i18next from "../../i18next";

vi.mock("../../ui/components/PhaserCanvas", () => ({
    default: () => null,
}));

vi.mock("../../hooks/usePets", () => ({
    usePets: () => ({ data: [], refetch: vi.fn() }),
    useDefaultPets: () => ({ data: [], refetch: vi.fn() }),
}));

afterEach(() => {
    cleanup();
});

describe("SettingWindow", () => {
    it("should be defined", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <I18nextProvider i18n={i18next}>
                    <MemoryRouter>
                        <MantineProvider>
                            <SettingWindow />
                        </MantineProvider>
                    </MemoryRouter>
                </I18nextProvider>
            </QueryClientProvider>
        );

        expect(screen).toBeDefined();
    });
});
