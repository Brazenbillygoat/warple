import { describe, expect, it } from "vitest";
import { BUILT_IN_ARTWORK } from "../artwork";
import { BLOOKY_PROFILE } from "../blooky";
import { BUILT_IN_PROFILES, selectDefaultProfile } from "../registry";
import { ENGINE_ROLES } from "../types";
import { validateCompanionProfile } from "../validator";

function copyProfile(): Record<string, any> {
    return structuredClone(BLOOKY_PROFILE);
}

describe("CompanionProfile validation", () => {
    it("validates and freezes the complete Blooky baseline", () => {
        const profile = validateCompanionProfile(BLOOKY_PROFILE);

        expect(Object.keys(profile.animations)).toEqual([
            "stand",
            "walk",
            "sit",
            "greet",
            "jump",
            "fall",
            "drag",
            "crawl",
            "climb",
        ]);
        expect(profile.roles).toEqual(Object.fromEntries(ENGINE_ROLES.map((role) => [role, role])));
        expect(profile.attribution.sourceUrl).toBe(BLOOKY_PROFILE.attribution.sourceUrl);
        expect(profile.artwork).toEqual(BUILT_IN_ARTWORK["blooky-shimeji"]);
        expect(profile.behavior).toMatchObject({
            scale: 0.7,
            animationFrameRate: 9,
            gravity: { x: 0, y: 200 },
            movement: { speed: 54, acceleration: 108 },
            ordinaryTransitions: {
                cooldownMs: 3000,
                weights: { stand: 50, sit: 35, walk: 12, greet: 3 },
            },
            flip: { enabled: true, cooldownMs: 5000 },
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
        });
        expect(Object.isFrozen(profile)).toBe(true);
        expect(Object.isFrozen(profile.behavior)).toBe(true);
    });

    it("ships exactly one programmatically selected built-in profile", () => {
        expect(Object.keys(BUILT_IN_PROFILES)).toEqual(["blooky"]);
        expect(selectDefaultProfile().id).toBe("blooky");
    });

    it("supports profile-specific animation names through engine-role mappings", () => {
        const profile = copyProfile();
        profile.animations["quiet-pose"] = profile.animations.stand;
        delete profile.animations.stand;
        profile.roles.stand = "quiet-pose";

        expect(validateCompanionProfile(profile).roles.stand).toBe("quiet-pose");
    });

    it.each([
        ["unsupported schema", (profile: any) => (profile.schemaVersion = 2)],
        ["invalid identifier", (profile: any) => (profile.id = "Blooky Profile")],
        ["unknown field", (profile: any) => (profile.executable = "nope")],
        ["unknown artwork", (profile: any) => (profile.artworkId = "not-registered")],
        ["missing attribution", (profile: any) => (profile.attribution.sourceUrl = "")],
        ["non-HTTPS attribution", (profile: any) => (profile.attribution.sourceUrl = "http://example.com")],
        ["sheet mismatch", (profile: any) => (profile.frame.columns = 7)],
        ["out-of-bounds row", (profile: any) => (profile.animations.climb.row = 10)],
        ["unknown mapped animation", (profile: any) => (profile.roles.walk = "moonwalk")],
        ["non-finite behavior", (profile: any) => (profile.behavior.gravity.y = Number.NaN)],
        [
            "non-finite throw speed",
            (profile: any) => (profile.behavior.dragging.maxThrowSpeed = Number.NaN),
        ],
        ["unsafe throw speed", (profile: any) => (profile.behavior.dragging.maxThrowSpeed = 5001)],
        ["unsafe scale", (profile: any) => (profile.behavior.scale = 100)],
        [
            "zero ordinary weights",
            (profile: any) =>
                (profile.behavior.ordinaryTransitions.weights = {
                    stand: 0,
                    sit: 0,
                    walk: 0,
                    greet: 0,
                }),
        ],
        ["physics-only ordinary role", (profile: any) => (profile.behavior.ordinaryTransitions.weights.jump = 1)],
        ["invalid transition", (profile: any) => (profile.behavior.supportedTransitions.jumpToFall = "yes")],
    ])("rejects %s", (_label, mutate) => {
        const profile = copyProfile();
        mutate(profile);
        expect(() => validateCompanionProfile(profile)).toThrow("Invalid companion profile");
    });
});
