import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { confirm } from "@tauri-apps/plugin-dialog";
import i18next from 'i18next';
import { error } from "@tauri-apps/plugin-log";
import { convertFileSrc } from '@tauri-apps/api/core';
import { isAbsolute } from '@tauri-apps/api/path';

export const PrimaryColor = 'pink';
export const ButtonVariant = 'outline';
export const CanvasSize = 224;

export const noPetDialog = () => {
    error("No pet found");
    confirm(i18next.t("Nya~ Oh, dear friend! In this whimsical realm of mine, where magic and wonder intertwine, alas, there are no delightful pets to be found. But fret not! Fear not! For you hold the power to change this tale. Simply venture into the enchanting settings and add a touch of furry companionship to make our world even more adorable and divine! Onegai~"), { title: "Warple Dialog", kind: 'info' }).then(async () => {
        // Close the empty overlay after the user acknowledges why no pet appeared.
        await getCurrentWebviewWindow().close();
    });
}

// Absolute custom assets need Tauri's asset protocol while bundled relative paths load normally.
export const convertFileToAssetProtocol = async (filePath: string) => {
    const absolute = await isAbsolute(filePath);
    if (absolute) return convertFileSrc(filePath);

    return filePath;
}
