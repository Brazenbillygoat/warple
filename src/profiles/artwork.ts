import type { BuiltInArtwork } from "./types";

export const BUILT_IN_ARTWORK = Object.freeze({
    "blooky-shimeji": Object.freeze({
        id: "blooky-shimeji",
        src: "/media/companions/blooky/spritesheet.png",
        width: 1024,
        height: 1152,
    }),
}) satisfies Readonly<Record<string, BuiltInArtwork>>;
