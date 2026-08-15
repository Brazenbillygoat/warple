import type { BuiltInArtwork } from "./types";

export const BUILT_IN_ARTWORK = Object.freeze({
    "blooky-shimeji": Object.freeze({
        id: "blooky-shimeji",
        src: "/media/companions/blooky/spritesheet.png",
        width: 1024,
        height: 1152,
    }),
    "jo-original": Object.freeze({
        id: "jo-original",
        src: "/media/companions/jo/spritesheet.png",
        width: 3328,
        height: 1920,
    }),
}) satisfies Readonly<Record<string, BuiltInArtwork>>;
