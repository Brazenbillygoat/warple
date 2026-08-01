import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { error } from "@tauri-apps/plugin-log";
import type { EngineRole, ValidatedCompanionProfile } from "../profiles/types";
import type { Point } from "../runtime/cursorAwareness";
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
    private cursorRequestInFlight = false;
    private latestCursorSnapshot: Point | undefined;
    private readonly ignoreCursorEventsDelayMs = 50;

    constructor(private readonly geometry: OverlayGeometry) {}

    public setInputManager(input: Phaser.Input.InputPlugin): void {
        this.input = input;
    }

    public checkIsMouseOverPet(): void {
        if (this.cursorRequestInFlight) return;
        this.cursorRequestInFlight = true;
        void invoke<NativeMousePosition | null>("get_mouse_position")
            .then((position) => {
                const localPosition = position ? this.toOverlayLocalPosition(position) : undefined;
                this.latestCursorSnapshot = this.isInsideWorkArea(localPosition)
                    ? localPosition
                    : undefined;
                if (localPosition && this.detectMouseOverPet(localPosition)) {
                    this.turnOffIgnoreCursorEvents();
                } else {
                    this.turnOnIgnoreCursorEvents();
                }
            })
            .catch((reason) => {
                this.latestCursorSnapshot = undefined;
                error(`Failed to read cursor position: ${String(reason)}`);
            })
            .finally(() => {
                this.cursorRequestInFlight = false;
            });
    }

    public getLatestCursorSnapshot(): Point | undefined {
        return this.latestCursorSnapshot;
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

    private toOverlayLocalPosition(position: NativeMousePosition): Point | undefined {
        const localX = position.clientX / this.geometry.scaleFactor - this.geometry.monitor.x;
        const localY = position.clientY / this.geometry.scaleFactor - this.geometry.monitor.y;
        if (!Number.isFinite(localX) || !Number.isFinite(localY)) return undefined;
        return Object.freeze({ x: localX, y: localY });
    }

    private isInsideWorkArea(position: Point | undefined): position is Point {
        if (!position) return false;
        const bounds = this.geometry.workArea;
        return (
            position.x >= bounds.x &&
            position.x <= bounds.x + bounds.width &&
            position.y >= bounds.y &&
            position.y <= bounds.y + bounds.height
        );
    }

    private detectMouseOverPet(position: Point): boolean {
        if (!this.input) return false;
        this.input.mousePointer.x = position.x;
        this.input.mousePointer.y = position.y;
        return this.input.hitTestPointer(this.input.activePointer).length > 0;
    }
}
