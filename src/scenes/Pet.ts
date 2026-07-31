import { convertFileSrc } from "@tauri-apps/api/core";
import { IPet } from "../types/IPet";
import { ISpriteConfig, SpriteType } from "../types/ISpriteConfig";

// This scene renders one inert pet for settings previews; desktop behavior lives in Pets.ts.
export class Pet extends Phaser.Scene {
    private pet: IPet | null = null;
    private sprite: ISpriteConfig | null = null;
    private playState: string | null = null;

    readonly frameRate: number = 9;
    readonly repeat: number = -1;

    constructor() {
        super({ key: 'Pet' });
    }

    preload(): void {
        this.sprite = this.game.registry.get('spriteConfig');
        this.playState = this.game.registry.get('playState');

        this.load.spritesheet({
            key: this.sprite!.name,
            url: this.sprite!.type === SpriteType.CUSTOM ? convertFileSrc(this.sprite!.imageSrc) : this.sprite!.imageSrc,
            frameConfig: this.getFrameSize(this.sprite!)
        });
    }

    create(): void {
        // Preview games are isolated, so each instance registers its own animation keys.
        for (const animationConfig of this.getAnimationConfigPerSprite(this.sprite!)) {
            this.anims.create(animationConfig);
        }

        this.pet = this.physics.add.sprite(this.physics.world.bounds.width / 2, this.physics.world.bounds.height / 2, this.sprite!.name) as IPet;

        this.pet.anims.play({
            key: `${this.playState}-${this.sprite!.name}`,
            repeat: this.repeat,
        });

        this.pet.body!.enable = false;

        // Input stays disabled so scrolling the settings page never grabs the preview canvas.
        this.input.keyboard!.enabled = false;
        this.input.mouse!.enabled = false;
    }

    getFrameSize(sprite: ISpriteConfig): { frameWidth: number, frameHeight: number } {
        if (sprite.frameSize) {
            return {
                frameWidth: sprite.frameSize,
                frameHeight: sprite.frameSize
            };
        };

        const frameWidth = sprite.width! / sprite.highestFrameMax!;
        const frameHeight = sprite.height! / sprite.totalSpriteLine!;
        return { frameWidth, frameHeight };
    }

    getAnimationConfigPerSprite(sprite: ISpriteConfig): {
        key: string;
        frames: Phaser.Types.Animations.AnimationFrame[];
        frameRate: number;
        repeat: number;
    }[] {
        let animationConfig = [];
        const HighestFrameMax = this.getHighestFrameMax(sprite);
        for (const state in sprite.states) {

            // Config frames are one-based while Phaser frame indexes are zero-based.
            const start = sprite.states[state].start !== undefined ?
                sprite.states[state].start! - 1 : (sprite.states[state].spriteLine! - 1) * HighestFrameMax;
            const end = sprite.states[state].end !== undefined ?
                sprite.states[state].end! - 1 : start + sprite.states[state].frameMax! - 1;

            animationConfig.push({
                key: `${state}-${sprite.name}`,
                frames: this.anims.generateFrameNumbers(sprite.name, {
                    start: start,
                    end: end,
                    first: start
                }),
                frameRate: this.frameRate,
                repeat: this.repeat,
            });
        }
        return animationConfig;
    }

    getHighestFrameMax(sprite: ISpriteConfig): number {
        if (sprite.highestFrameMax) return sprite.highestFrameMax;

        let highestFrameMax = 0;
        for (const state in sprite.states) {
            // Explicit start and end ranges do not need a calculated row width.
            if (!sprite.states[state].frameMax!) return 0;
            highestFrameMax = Math.max(highestFrameMax, sprite.states[state].frameMax!);
        }

        return highestFrameMax;
    }
}
