import { DefaultConfigName, IGetAppSetting } from "../types/ISetting";
import { invoke } from '@tauri-apps/api/core'
import { copyFile, BaseDirectory, mkdir } from "@tauri-apps/plugin-fs"
import { confirm } from "@tauri-apps/plugin-dialog";
import { IPetObject } from "../types/ISpriteConfig";
import { showNotification } from "./notification";
import i18next from "i18next";
import { error, info } from "@tauri-apps/plugin-log";

// default will return app settings, if key is provided, will return specific key
export async function getAppSettings({ configName = "settings.json", key = "app", withErrorDialog = true }: IGetAppSetting) {
    if (key !== "app") throw new Error(`Unsupported config key: ${key}`);

    const data = await invoke<any | null>("read_app_config", { config_name: configName });
    if (data === null) {
        if (withErrorDialog) await confirm(`Could not get data from ${configName}`, { title: "WindowPet Dialog", kind: 'error' });

        return;
    }

    return data;
}

// set a specific key under object app
// exp: { app: { key: value } }
interface ISetSetting extends IGetAppSetting {
    setKey: string,
    newValue: unknown,
}
export async function setSettings({ configName = "settings.json", key = "app", setKey, newValue }: ISetSetting) {
    if (key !== "app") throw new Error(`Unsupported config key: ${key}`);

    const setting: any = await getAppSettings({ configName });
    setting[setKey] = newValue;
    await invoke("write_app_config", { config_name: configName, value: setting });
}

// this function differs from setSettings because it will replace the whole config file, not just some specific key
export interface ISetConfig extends IGetAppSetting {
    newConfig: unknown,
}
export async function setConfig({ configName = "settings.json", key = "app", newConfig }: ISetConfig) {
    if (key !== "app") throw new Error(`Unsupported config key: ${key}`);
    await invoke("write_app_config", { config_name: configName, value: newConfig });
}

async function updateCustomPetConfig(newCustomPetPath: string) {
    const customPetConfig = await getAppSettings({
        configName: DefaultConfigName.PET_LINKER,
        withErrorDialog: false,
    });

    if (Array.isArray(customPetConfig)) {
        customPetConfig.push(newCustomPetPath);
        await setConfig({ configName: DefaultConfigName.PET_LINKER, newConfig: customPetConfig });
        return;
    }

    await setConfig({ configName: DefaultConfigName.PET_LINKER, newConfig: [newCustomPetPath] });
}

export async function saveCustomPet(petObject: IPetObject) {
    try {
        info(`Start saving custom pet, pet name: ${petObject.name}`);
        petObject.customId = crypto.randomUUID();
        const uniquePetFileName = `pet-${petObject.customId}`;
        const customPetConfigName = `custom-pets/${uniquePetFileName}.json`;
        const userImageSrc = petObject.imageSrc as string;
        petObject.imageSrc = await invoke("combine_config_path", { config_name: `assets/${uniquePetFileName}.png` }) as string;

        // create dir if not exist and copy file to assets folder
        await mkdir('assets', { baseDir: BaseDirectory.AppConfig, recursive: true });
        await copyFile(userImageSrc, petObject.imageSrc);

        await setConfig({ configName: customPetConfigName, newConfig: petObject });

        // this config is the one that will be used to load custom pets (act as a list of custom pets)
        await updateCustomPetConfig(customPetConfigName);

        showNotification({
            title: i18next.t("Custom Pet Added"),
            message: i18next.t(`pet name has been added to your custom pet list, restart WindowPet and check pet shop to spawn your custom pet`, { name: petObject.name }),
        });
        info(`Successfully save custom pet, pet name: ${petObject.name}`);
    } catch (err) {
        error(`Error at saveCustomPet: ${err}`);
        showNotification({
            title: i18next.t("Error Adding Custom Pet"),
            message: err as any,
            isError: true,
        });
    }
}
