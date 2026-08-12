import {
    PROFILE_SCHEMA_VERSION,
    type CompanionProfile,
} from "./types";

export const BLOOKY_PROFILE = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id: "blooky",
    displayName: "Blooky",
    attribution: {
        sourceUrl:
            "https://undertaleshimejis.tumblr.com/post/140301252826/thank-you-for-6000-followers-here-i-present?is_related_post=1",
    },
    artworkId: "blooky-shimeji",
    frame: {
        frameWidth: 128,
        frameHeight: 128,
        columns: 8,
        rows: 9,
    },
    animations: {
        stand: { row: 1, frames: 1 },
        walk: { row: 2, frames: 4 },
        sit: { row: 3, frames: 8 },
        greet: { row: 4, frames: 4 },
        jump: { row: 5, frames: 1 },
        fall: { row: 6, frames: 3 },
        drag: { row: 7, frames: 1 },
        crawl: { row: 8, frames: 8 },
        climb: { row: 9, frames: 8 },
    },
    roles: {
        stand: "stand",
        walk: "walk",
        sit: "sit",
        greet: "greet",
        crawl: "crawl",
        climb: "climb",
        jump: "jump",
        fall: "fall",
        drag: "drag",
        special: "greet",
    },
    behavior: {
        scale: 0.7,
        animationFrameRate: 9,
        gravity: { x: 0, y: 200 },
        movement: { speed: 54, acceleration: 108 },
        ordinaryTransitions: {
            cooldownMs: 3000,
            weights: { stand: 50, sit: 35, walk: 12, greet: 3, special: 0 },
        },
        flip: {
            enabled: true,
            cooldownMs: 5000,
            sampleMax: 2000,
            triggerMin: 888,
            triggerMax: 890,
        },
        dragging: {
            enabled: true,
            throwVelocityMultiplier: 9.9,
            maxThrowSpeed: 1200,
        },
        climbing: {
            enabled: true,
            randomJumpSampleMax: 500,
            randomJumpTrigger: 78,
            jumpDurationMs: 3000,
            pauseSampleMax: 500,
            pauseTriggerMax: 5,
            pauseMinMs: 3000,
            pauseMaxMs: 6000,
        },
        supportedTransitions: {
            initialDrop: true,
            jumpToFall: true,
            wallToClimb: true,
            climbToCrawl: true,
            crawlEdgeToJump: true,
            dragToThrow: true,
        },
    },
} as const satisfies CompanionProfile;
