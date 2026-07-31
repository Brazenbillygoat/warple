import { create } from "zustand";
import { ISettingStoreState } from "../types/hooks/type";
import defaultPetConfig from "../config/pet_config";
import defaultSettings from "../../src-tauri/src/app/default/settings.json";
import { ColorScheme } from "../types/ISetting";

export const useSettingStore = create<ISettingStoreState>()((set) => ({
    language: localStorage.getItem("language") ?? defaultSettings.language,
    setLanguage: (newLanguage) => {
        set({ language: newLanguage })
    },
    theme: localStorage.getItem("theme") as ColorScheme ?? defaultSettings.theme,
    setTheme: (newTheme) => {
        set({ theme: newTheme })
    },
    allowPetAboveTaskbar: defaultSettings.allowPetAboveTaskbar ?? false,
    setAllowPetAboveTaskbar: (newBoolean) => {
        set({ allowPetAboveTaskbar: newBoolean })
    },
    allowPetInteraction: defaultSettings.allowPetInteraction ?? true,
    setAllowPetInteraction: (newBoolean) => {
        set({ allowPetInteraction: newBoolean })
    },
    allowPetClimbing: defaultSettings.allowPetClimbing ?? true,
    setAllowPetClimbing: (newBoolean) => {
        set({ allowPetClimbing: newBoolean })
    },
    allowOverridePetScale: defaultSettings.allowPetInteraction ?? true,
    setAllowOverridePetScale: (newBoolean) => {
        set({allowOverridePetScale: newBoolean})
    },
    petScale: defaultSettings.petScale ?? 0.7,
    setPetScale: (petScale) => {
        set({petScale: petScale})
    },
    // This runtime list mirrors pets.json so React can update Phaser without reloading the app.
    pets: [],
    setPets: (newPets) => {
        set({ pets: [...newPets] })
    },
    // This catalog combines bundled pets with custom pets discovered through pet_linker.json.
    defaultPet: JSON.parse(JSON.stringify(defaultPetConfig)),
    setDefaultPet: (newDefaultPet) => {
        set({ defaultPet: [...newDefaultPet] })
    },
}));
