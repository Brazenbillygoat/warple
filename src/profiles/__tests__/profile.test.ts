import { describe, expect, it } from "vitest";
import { BUILT_IN_ARTWORK } from "../artwork";
import { BLOOKY_PROFILE } from "../blooky";
import { JO_PROFILE } from "../jo";
import {
    BUILT_IN_PROFILES,
    DEFAULT_PROFILE_ID,
    resolveBuiltInProfiles,
    selectDefaultProfile,
} from "../registry";
import { validateCompanionProfile } from "../validator";

function copyProfile(): Record<string, any> {
    return structuredClone(BLOOKY_PROFILE);
}

function alternateProfile(): Record<string, any> {
    const profile = copyProfile();
    profile.id = "jo";
    profile.displayName = "Jo";
    return profile;
}

function alternateRegistry(): Record<string, unknown> {
    return { blooky: copyProfile(), jo: alternateProfile() };
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
        expect(profile.roles).toEqual({
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
        });
        expect(profile.attribution.sourceUrl).toBe(BLOOKY_PROFILE.attribution.sourceUrl);
        expect(profile.artwork).toEqual(BUILT_IN_ARTWORK["blooky-shimeji"]);
        expect(profile.behavior).toMatchObject({
            scale: 0.7,
            animationFrameRate: 9,
            gravity: { x: 0, y: 200 },
            movement: { speed: 54, acceleration: 108 },
            ordinaryTransitions: {
                cooldownMs: 3000,
                weights: { stand: 50, sit: 35, walk: 12, greet: 3, special: 0 },
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

    it("ships the stable Blooky and Jo built-in catalog", () => {
        expect(Object.keys(BUILT_IN_PROFILES)).toEqual(["blooky", "jo"]);
        expect(selectDefaultProfile().id).toBe("blooky");

        const resolved = resolveBuiltInProfiles(undefined);
        expect(resolved.profile.id).toBe("blooky");
        expect(resolved.catalog).toEqual([
            { id: "blooky", displayName: "Blooky" },
            { id: "jo", displayName: "Jo" },
        ]);
        expect(Object.isFrozen(resolved.catalog)).toBe(true);
    });

    it("validates Jo's original artwork, animation geometry, and inherited behavior", () => {
        const profile = validateCompanionProfile(JO_PROFILE);

        expect(profile.attribution.sourceUrl).toBe("https://brazenbillygoat.github.io/mysite/");
        expect(profile.artwork).toEqual(BUILT_IN_ARTWORK["jo-original"]);
        expect(profile.frame).toEqual({
            frameWidth: 128,
            frameHeight: 128,
            columns: 26,
            rows: 10,
        });
        expect(profile.animations).toEqual({
            stand: { row: 1, frames: 26 },
            walk: { row: 2, frames: 12 },
            sit: { row: 3, frames: 26 },
            greet: { row: 4, frames: 16 },
            jump: { row: 7, frames: 1 },
            fall: { row: 8, frames: 9 },
            drag: { row: 9, frames: 1 },
            crawl: { row: 5, frames: 12 },
            climb: { row: 6, frames: 12 },
            "mj-spin": { row: 10, frames: 12 },
        });
        expect(profile.roles).toEqual({
            stand: "stand",
            walk: "walk",
            sit: "sit",
            greet: "greet",
            crawl: "crawl",
            climb: "climb",
            jump: "jump",
            fall: "fall",
            drag: "drag",
            special: "mj-spin",
        });
        expect(profile.behavior).toMatchObject({
            scale: BLOOKY_PROFILE.behavior.scale,
            animationFrameRate: 20,
            gravity: BLOOKY_PROFILE.behavior.gravity,
            movement: BLOOKY_PROFILE.behavior.movement,
            ordinaryTransitions: {
                cooldownMs: BLOOKY_PROFILE.behavior.ordinaryTransitions.cooldownMs,
            },
            dragging: BLOOKY_PROFILE.behavior.dragging,
            climbing: BLOOKY_PROFILE.behavior.climbing,
            supportedTransitions: BLOOKY_PROFILE.behavior.supportedTransitions,
        });
        expect(profile.behavior.ordinaryTransitions.weights).toEqual({
            stand: 50,
            sit: 35,
            walk: 12,
            greet: 3,
            special: 2,
        });
    });

    it("supports profile-specific animation names through engine-role mappings", () => {
        const profile = copyProfile();
        profile.animations["quiet-pose"] = profile.animations.stand;
        delete profile.animations.stand;
        profile.roles.stand = "quiet-pose";

        expect(validateCompanionProfile(profile).roles.stand).toBe("quiet-pose");
    });

    it.each([
        ["unsupported schema", (profile: any) => (profile.schemaVersion = 3)],
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
                    special: 0,
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

describe("built-in profile resolution", () => {
    it("produces a stable ordered catalog and selects the default when nothing is requested", () => {
        const resolved = resolveBuiltInProfiles(undefined, alternateRegistry());

        expect(resolved.profile.id).toBe(DEFAULT_PROFILE_ID);
        expect(resolved.catalog).toEqual([
            { id: "blooky", displayName: "Blooky" },
            { id: "jo", displayName: "Jo" },
        ]);
        expect(Object.isFrozen(resolved.catalog)).toBe(true);
        expect(Object.isFrozen(resolved.catalog[0])).toBe(true);
    });

    it("selects a requested valid profile while preserving registry order", () => {
        const resolved = resolveBuiltInProfiles("jo", alternateRegistry());

        expect(resolved.profile.id).toBe("jo");
        expect(resolved.catalog[0].id).toBe("blooky");
        expect(resolved.catalog[1].id).toBe("jo");
    });

    it("selects the shipped Jo profile without a fixture registry", () => {
        const resolved = resolveBuiltInProfiles("jo");

        expect(resolved.profile.id).toBe("jo");
        expect(resolved.catalog).toEqual([
            { id: "blooky", displayName: "Blooky" },
            { id: "jo", displayName: "Jo" },
        ]);
    });

    it.each([
        ["missing", undefined],
        ["empty", ""],
        ["stale", "ghost"],
        ["unregistered", "zombie"],
    ])("falls back to the validated default for a %s requested id", (_label, requested) => {
        const resolved = resolveBuiltInProfiles(requested, alternateRegistry());
        expect(resolved.profile.id).toBe(DEFAULT_PROFILE_ID);
    });

    it("rejects a registry key that does not match the profile id", () => {
        const registry = { mismatched: alternateProfile() };
        expect(() => resolveBuiltInProfiles(undefined, registry, "mismatched")).toThrow(
            "does not match profile id",
        );
    });

    it("fails conspicuously when a shipped non-default profile is malformed", () => {
        const registry = { blooky: copyProfile(), jo: alternateProfile() };
        (registry.jo as any).schemaVersion = 999;
        expect(() => resolveBuiltInProfiles(undefined, registry)).toThrow("Invalid companion profile");
    });

    it("aborts startup when the default profile itself is invalid", () => {
        const registry = { blooky: copyProfile() };
        (registry.blooky as any).schemaVersion = 999;
        expect(() => resolveBuiltInProfiles(undefined, registry)).toThrow("Invalid companion profile");
    });

    it("aborts startup when the default profile is not registered", () => {
        const registry = { jo: alternateProfile() };
        expect(() => resolveBuiltInProfiles(undefined, registry)).toThrow(
            "Default companion profile is not registered",
        );
    });

    it("does not mutate profile objects or registry order", () => {
        const registry = alternateRegistry();
        const originalKeys = Object.keys(registry);
        resolveBuiltInProfiles("jo", registry);

        expect(Object.keys(registry)).toEqual(originalKeys);
        expect((registry as any).blooky).toEqual(copyProfile());
    });
});
