import { BLOOKY_PROFILE } from "./blooky";
import { validateCompanionProfile } from "./validator";
import type { BuiltInArtwork, ValidatedCompanionProfile } from "./types";

export const DEFAULT_PROFILE_ID = "blooky";

export const BUILT_IN_PROFILES = Object.freeze({
    blooky: BLOOKY_PROFILE,
});

export function selectDefaultProfile(
    registry: Readonly<Record<string, unknown>> = BUILT_IN_PROFILES,
    defaultProfileId = DEFAULT_PROFILE_ID,
    artworkRegistry?: Readonly<Record<string, BuiltInArtwork>>,
): ValidatedCompanionProfile {
    const selected = registry[defaultProfileId];
    if (!selected) throw new Error("Default companion profile is not registered");
    return validateCompanionProfile(selected, artworkRegistry);
}
