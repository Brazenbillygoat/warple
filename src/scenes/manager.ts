import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { error } from "@tauri-apps/plugin-log";
import type { EngineRole, ValidatedCompanionProfile } from "../profiles/types";
import type { OverlayGeometry } from "../runtime/geometry";

const appWindow = getCurrentWebviewWindow();

export class ConfigManager {
    private load: Phaser.Loader.LoaderPlugin | undefined;
    private anims: Phaser.Animations.AnimationManager | undefined;
    private registered = false;

    constructor(private readonly profile: ValidatedCompanionProfile) {}

    public setManagers({
        load,
        anims,
    }: {
        load: Phaser.Loader.LoaderPlugin;
        anims: Phaser.Animations.AnimationManager;
    }): void {
        this.load = load;
        this.anims = anims;
    }

    public loadSpriteSheet(): void {
        if (!this.load) throw new Error("Loader manager is not set");
        this.load.spritesheet({
            key: this.profile.id,
            url: this.profile.artwork.src,
            frameConfig: {
                frameWidth: this.profile.frame.frameWidth,
                frameHeight: this.profile.frame.frameHeight,
            },
        });
    }

    public registerAnimations(): void {
        if (this.registered) return;
        if (!this.anims) throw new Error("Animation manager is not set");

        for (const [name, definition] of Object.entries(this.profile.animations)) {
            const key = this.getAnimationKey(name);
            if (this.anims.exists(key)) continue;
            const start = (definition.row - 1) * this.profile.frame.columns;
            this.anims.create({
                key,
                frames: this.anims.generateFrameNumbers(this.profile.id, {
                    start,
                    end: start + definition.frames - 1,
                    first: start,
                }),
                frameRate: this.profile.behavior.animationFrameRate,
                repeat: -1,
            });
        }
        this.registered = true;
    }

    public getAnimationKeyForRole(role: EngineRole): string {
        return this.getAnimationKey(this.profile.roles[role]);
    }

    private getAnimationKey(animationName: string): string {
        return `${animationName}-${this.profile.id}`;
    }
}

interface NativeMousePosition {
    readonly clientX: number;
    readonly clientY: number;
}

export class InputManager {
    private input: Phaser.Input.InputPlugin | undefined;
    private isIgnoringCursorEvents = true;
    private readonly ignoreCursorEventsDelayMs = 50;

    constructor(private readonly geometry: OverlayGeometry) {}

    public setInputManager(input: Phaser.Input.InputPlugin): void {
        this.input = input;
    }

    public checkIsMouseOverPet(): void {
        void invoke<NativeMousePosition | null>("get_mouse_position")
            .then((position) => {
                if (position && this.detectMouseOverPet(position)) {
                    this.turnOffIgnoreCursorEvents();
                } else {
                    this.turnOnIgnoreCursorEvents();
                }
            })
            .catch((reason) => error(`Failed to read cursor position: ${String(reason)}`));
    }

    public turnOffIgnoreCursorEvents(): void {
        if (!this.isIgnoringCursorEvents) return;
        void appWindow
            .setIgnoreCursorEvents(false)
            .then(() => {
                this.isIgnoringCursorEvents = false;
            })
            .catch((reason) => error(`Failed to enable overlay input: ${String(reason)}`));
    }

    public turnOnIgnoreCursorEvents(): void {
        if (this.isIgnoringCursorEvents) return;
        window.setTimeout(() => {
            void appWindow
                .setIgnoreCursorEvents(true)
                .then(() => {
                    this.isIgnoringCursorEvents = true;
                })
                .catch((reason) => error(`Failed to restore click-through: ${String(reason)}`));
        }, this.ignoreCursorEventsDelayMs);
    }

    private detectMouseOverPet(position: NativeMousePosition): boolean {
        if (!this.input) return false;
        const localX = position.clientX / this.geometry.scaleFactor - this.geometry.monitor.x;
        const localY = position.clientY / this.geometry.scaleFactor - this.geometry.monitor.y;
        this.input.mousePointer.x = localX;
        this.input.mousePointer.y = localY;
        return this.input.hitTestPointer(this.input.activePointer).length > 0;
    }
}
