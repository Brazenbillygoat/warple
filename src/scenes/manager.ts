import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ISpriteConfig, SpriteType } from "../types/ISpriteConfig";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { error } from "@tauri-apps/plugin-log";
const appWindow = getCurrentWebviewWindow()

// ConfigManager turns persisted sprite definitions into shared Phaser textures and animations.
export class ConfigManager {
    private spriteConfig: ISpriteConfig[] = [];
    private load: Phaser.Loader.LoaderPlugin | undefined;
    private textures: Phaser.Textures.TextureManager | undefined;
    private anims: Phaser.Animations.AnimationManager | undefined;
    // Texture keys are shared by name so duplicate pet instances reuse the same sprite sheet.
    private registeredName: Map<string, boolean> = new Map();

    public readonly FRAME_RATE: number;
    private readonly REPEAT: number = -1;

    constructor({
        FRAME_RATE,
    }: {
        FRAME_RATE: number;
    }) {
        this.FRAME_RATE = FRAME_RATE;
    }

    public loadAllSpriteSheet(): void {
        try {
            if (!this.spriteConfig) {
                return;
            }

            this.spriteConfig.forEach((sprite) => {
                this.loadSpriteSheet(sprite);
            });
        } catch (error) {
            console.log("Error in ConfigManager loadAllSpriteSheet()", error);
        }
    }

    public registerSpriteStateAnimation(sprite: ISpriteConfig): void {
        if (!this.anims) {
            error("Anims manager is not set");
            return;
        }

        if (!this.load) {
            error("Loader manager is not set");
            return;
        }
        
        // Reject incomplete custom definitions before Phaser tries to render a broken texture.
        if (!this.validatePetSprite(sprite)) return;

        // Dynamic pets can arrive after preload, so load their texture before registering animations.
        if (this.textures && !this.textures.exists(sprite.name)) {
            this.loadSpriteSheet(sprite);
            this.load.start();

            this.load.once("complete", () => {
                // Registration must retry after Phaser finishes the asynchronous texture load.
                this.registerSpriteStateAnimation(sprite);
            });
            return;
        }

        // Normalize user-authored state names because behavior lookups use lowercase keys.
        for (const state in sprite.states) {
            if (state.toLowerCase() !== state) {
                sprite.states[state.toLowerCase()] = sprite.states[state];
                delete sprite.states[state];
            }
        }

        for (const animationConfig of this.getAnimationConfigPerSprite(
            sprite
        )) {
            if (!this.anims.exists(animationConfig.key)) {
                this.anims.create(animationConfig);
            }
        }
    }

    public setConfigManager({
        load,
        textures,
        anims,
    }: {
        load: Phaser.Loader.LoaderPlugin;
        textures: Phaser.Textures.TextureManager;
        anims: Phaser.Animations.AnimationManager;
    }): void {
        this.load = load;
        this.textures = textures;
        this.anims = anims;
    }

    public setSpriteConfig(spriteConfig: ISpriteConfig[]): void {
        this.spriteConfig = spriteConfig;
    }

    public getSpriteConfig(): ISpriteConfig[] {
        return this.spriteConfig;
    }

    private loadSpriteSheet(sprite: ISpriteConfig): void {
        if (!this.load) {
            error("Loader manager is not set");
            return;
        }

        // Multiple pets with the same name intentionally reuse one Phaser texture key.
        if (this.checkDuplicateName(sprite.name)) {
            return;
        }
        if (!this.validatePetSprite(sprite)) {
            return;
        }

        this.load.spritesheet({
            key: sprite.name,
            url:
                sprite.type === SpriteType.CUSTOM
                    ? convertFileSrc(sprite.imageSrc)
                    : sprite.imageSrc,
            frameConfig: this.getFrameSize(sprite),
        });
    }

    private getAnimationConfigPerSprite(sprite: ISpriteConfig): {
        key: string;
        frames: Phaser.Types.Animations.AnimationFrame[];
        frameRate: number;
        repeat: number;
    }[] {
        if (!sprite.states) {
            return [];
        }

        if (!this.anims) {
            error("Anims manager is not set");
            return [];
        }

        let animationConfig = [];
        const HighestFrameMax = this.getHighestFrameMax(sprite);
        for (const state in sprite.states) {
            // Support row-based and range-based configs, then convert one-based values for Phaser.
            const start =
                sprite.states[state].start !== undefined
                    ? sprite.states[state].start! - 1
                    : (sprite.states[state].spriteLine! - 1) * HighestFrameMax;
            const end =
                sprite.states[state].end !== undefined
                    ? sprite.states[state].end! - 1
                    : start + sprite.states[state].frameMax! - 1;

            animationConfig.push({
                // State names are namespaced by texture so different pets can share behavior names.
                key: `${state}-${sprite.name}`,
                frames: this.anims.generateFrameNumbers(sprite.name, {
                    start: start,
                    end: end,
                    first: start,
                }),
                frameRate: this.FRAME_RATE,
                repeat: this.REPEAT,
            });
        }
        return animationConfig;
    }

    public getStateName(
        state: string,
        pet: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody
    ): string {
        return `${state}-${pet.texture.key}`;
    }

    private getHighestFrameMax(sprite: ISpriteConfig): number {
        if (sprite.highestFrameMax) {
            return sprite.highestFrameMax;
        }

        let highestFrameMax = 0;
        for (const state in sprite.states) {
            // Range-based states do not need a calculated row width.
            if (!sprite.states[state].frameMax!) return 0;
            highestFrameMax = Math.max(
                highestFrameMax,
                sprite.states[state].frameMax!
            );
        }

        return highestFrameMax;
    }

    public getFrameSize(sprite: ISpriteConfig): {
        frameWidth: number;
        frameHeight: number;
    } {
        if (sprite.frameSize) {
            return {
                frameWidth: sprite.frameSize,
                frameHeight: sprite.frameSize,
            };
        }

        const frameWidth = sprite.width! / sprite.highestFrameMax!;
        const frameHeight = sprite.height! / sprite.totalSpriteLine!;
        return { frameWidth, frameHeight };
    }

    private checkDuplicateName(name: string): boolean {
        if (this.registeredName.has(name)) {
            console.log(`Sprite name ${name} is already registered`);
            return true;
        }
        this.registeredName.set(name, true);
        return false;
    }

    private validatePetSprite(sprite: ISpriteConfig): boolean {
        if (!sprite.name || !sprite.imageSrc || !sprite.states) {
            return false;
        }

        // Accept either a square frameSize or enough sheet dimensions to calculate each frame.
        if (
            !sprite.frameSize &&
            (!sprite.width ||
                !sprite.height ||
                !sprite.highestFrameMax ||
                !sprite.totalSpriteLine)
        ) {
            return false;
        }

        for (const state in sprite.states) {
            if (
                (!sprite.states[state].spriteLine ||
                    !sprite.states[state].frameMax) &&
                (!sprite.states[state].start || !sprite.states[state].end)
            ) {
                return false;
            }
        }

        return true;
    }
}

// InputManager makes the overlay interactive only while the OS cursor is over a pet.
export class InputManager {
    private input: Phaser.Input.InputPlugin | undefined;
    private isIgnoreCursorEvents: boolean = false;

    private readonly IGNORE_CURSOR_EVENTS_DELAY: number = 50;

    public setInputManager({ input }: { input: Phaser.Input.InputPlugin }) {
        this.input = input;
    }

    public checkIsMouseInOnPet(): void {
        try {
            invoke("get_mouse_position").then((event: any) => {
                if (this.detectMouseOverPet(event.clientX, event.clientY)) {
                    this.turnOffIgnoreCursorEvents();
                    return;
                }

                this.turnOnIgnoreCursorEvents();
            });
        } catch (error) {
            console.log("Error in InputManager checkIsMouseInOnPet()", error);
        }
    }

    public turnOffIgnoreCursorEvents(): void {
        try {
            if (this.isIgnoreCursorEvents) {
                appWindow.setIgnoreCursorEvents(false).then(() => {
                    this.isIgnoreCursorEvents = false;
                });
            }
        } catch (error) {
            console.log(
                "Error in InputManager turnOffIgnoreCursorEvents()",
                error
            );
        }
    }

    public turnOnIgnoreCursorEvents(): void {
        try {
            if (!this.isIgnoreCursorEvents) {
                // Debounce WebView2 cursor-mode changes to avoid invalid window-handle errors.
                setTimeout(() => {
                    appWindow.setIgnoreCursorEvents(true).then(() => {
                        this.isIgnoreCursorEvents = true;
                    });
                }, this.IGNORE_CURSOR_EVENTS_DELAY);
            }
        } catch (error) {
            console.log(
                "Error in InputManager turnOnIgnoreCursorEvents()",
                error
            );
        }
    }

    private detectMouseOverPet(clientX: number, clientY: number): boolean {
        try {
            if (!this.input) {
                return false;
            }

            // OS cursor coordinates include display scaling while Phaser's game world does not.
            this.input.mousePointer.x = clientX / window.devicePixelRatio;
            this.input.mousePointer.y = clientY / window.devicePixelRatio;

            // Pixel-perfect hit testing keeps empty transparent sprite areas click-through.
            return (
                this.input.hitTestPointer(this.input.activePointer).length > 0
            );
        } catch (error) {
            console.log("Error in InputManager detectMouseOverPet()", error);
            return false;
        }
    }
}
