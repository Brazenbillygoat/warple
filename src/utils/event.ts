import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { DispatchType, EventType } from '../types/IEvents';
import { ISpriteConfig } from '../types/ISpriteConfig';

interface IEmitReRenderPetsEvent {
    dispatchType: DispatchType;
    newValue?: boolean | string | ISpriteConfig | number;
}

export const emitUpdatePetsEvent = async ({dispatchType, newValue}: IEmitReRenderPetsEvent) => {
    // Settings and the overlay run in separate webviews, so live changes cross a Tauri event.
    const mainWindow = await WebviewWindow.getByLabel('main');

    if (mainWindow) {
        await mainWindow.emitTo('main', EventType.SettingWindowToPetOverlay, {
            message: 'Hey, re-render pets! :)',
            dispatchType: dispatchType,
            value: newValue
        });
    }
};
