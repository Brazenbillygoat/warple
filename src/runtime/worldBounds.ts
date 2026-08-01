import type { Rectangle } from "./geometry";
import type { EngineRole } from "../profiles/types";

export interface SpriteGeometry {
    readonly width: number;
    readonly height: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly originX: number;
    readonly originY: number;
}

export interface SpriteCenters {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

export interface WorldBoundaryContacts {
    readonly up: boolean;
    readonly down: boolean;
    readonly left: boolean;
    readonly right: boolean;
}

export type WorldBoundaryAction =
    | "crawl-edge-jump"
    | "ceiling-crawl"
    | "ceiling-fall"
    | "landing"
    | "side"
    | "none";

export function selectWorldBoundaryAction(
    role: EngineRole,
    contacts: WorldBoundaryContacts,
    crawlEdgeToJump: boolean,
    ceilingToCrawl: boolean,
): WorldBoundaryAction {
    if (role === "crawl" && (contacts.left || contacts.right) && crawlEdgeToJump) {
        return "crawl-edge-jump";
    }
    if (contacts.up) {
        if (role === "crawl") return "none";
        return ceilingToCrawl ? "ceiling-crawl" : "ceiling-fall";
    }
    if (contacts.down) return "landing";
    if (contacts.left || contacts.right) return "side";
    return "none";
}

export function getSpriteCentersInsideBounds(
    bounds: Rectangle,
    sprite: SpriteGeometry,
): SpriteCenters {
    const halfWidth = sprite.width * Math.abs(sprite.scaleX) * sprite.originX;
    const halfHeight = sprite.height * Math.abs(sprite.scaleY) * sprite.originY;
    return {
        left: bounds.x + halfWidth,
        right: bounds.x + bounds.width - halfWidth,
        top: bounds.y + halfHeight,
        bottom: bounds.y + bounds.height - halfHeight,
    };
}
