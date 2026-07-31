export interface ISpriteStateKey {
    [key: string]: {
        // Row-based states identify a sprite-sheet row and the number of frames it contains.
        spriteLine?: number;
        frameMax?: number;
        // Range-based states use one-based inclusive positions converted to Phaser frame indexes.
        start?: number;
        end?: number;
    }
}

export enum SpriteType {
    DEFAULT = 'default',
    CUSTOM = 'custom',
}

// A square frameSize replaces width, height, highestFrameMax, and totalSpriteLine.
export interface ISpriteConfig {
    name: string,
    credit?: {
        // Original download or asset source.
        resource?: string,
        // Related post or project page.
        link?: string,
        // Creator name or social profile.
        socialMedia?: string,
    },
    id?: string,
    width?: number,
    height?: number,
    frameSize?: number,
    highestFrameMax?: number,
    totalSpriteLine?: number,
    type?: SpriteType,
    customId?: string,
    imageSrc: string,
    states: ISpriteStateKey,
}

export interface IPetObject {
    frameSize: number;
    imageSrc: string;
    name: string;
    states: {
        [key: string]: {
            start: number;
            end: number;
        };
    };
    customId?: string;
}
