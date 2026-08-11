import { describe, expect, it } from "vitest";
import { BUILT_IN_ARTWORK } from "../artwork";
import { BLOOKY_PROFILE } from "../blooky";
import {
    BUILT_IN_PROFILES,
    DEFAULT_PROFILE_ID,
    resolveBuiltInProfiles,
    selectDefaultProfile,
} from "../registry";
import { ENGINE_ROLES } from "../types";
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

    it("ships exactly the current Blooky built-in catalog", () => {
        expect(Object.keys(BUILT_IN_PROFILES)).toEqual(["blooky"]);
        expect(selectDefaultProfile().id).toBe("blooky");

        const resolved = resolveBuiltInProfiles(undefined);
        expect(resolved.profile.id).toBe("blooky");
        expect(resolved.catalog).toEqual([{ id: "blooky", displayName: "Blooky" }]);
        expect(Object.isFrozen(resolved.catalog)).toBe(true);
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
