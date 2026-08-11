import { BLOOKY_PROFILE } from "./blooky";
import { JO_PROFILE } from "./jo";
import { validateCompanionProfile } from "./validator";
import type {
    BuiltInArtwork,
    ProfileCatalogEntry,
    ValidatedCompanionProfile,
} from "./types";

export const DEFAULT_PROFILE_ID = "blooky";

export const BUILT_IN_PROFILES = Object.freeze({
    blooky: BLOOKY_PROFILE,
    jo: JO_PROFILE,
});

export interface ResolvedProfiles {
    readonly profile: ValidatedCompanionProfile;
    readonly catalog: readonly ProfileCatalogEntry[];
}

export function selectDefaultProfile(
    registry: Readonly<Record<string, unknown>> = BUILT_IN_PROFILES,
    defaultProfileId = DEFAULT_PROFILE_ID,
    artworkRegistry?: Readonly<Record<string, BuiltInArtwork>>,
): ValidatedCompanionProfile {
    const selected = registry[defaultProfileId];
    if (!selected) throw new Error("Default companion profile is not registered");
    return validateCompanionProfile(selected, artworkRegistry);
}

export function resolveBuiltInProfiles(
    requestedProfileId: string | undefined,
    registry: Readonly<Record<string, unknown>> = BUILT_IN_PROFILES,
    defaultProfileId = DEFAULT_PROFILE_ID,
    artworkRegistry?: Readonly<Record<string, BuiltInArtwork>>,
): ResolvedProfiles {
    if (!registry[defaultProfileId]) {
        throw new Error("Default companion profile is not registered");
    }

    const catalog: ProfileCatalogEntry[] = [];
    const validated: ValidatedCompanionProfile[] = [];
    for (const [key, candidate] of Object.entries(registry)) {
        if (!candidate) continue;
        const profile = validateCompanionProfile(candidate, artworkRegistry);
        if (profile.id !== key) {
            throw new Error(`Registry key ${key} does not match profile id ${profile.id}`);
        }
        validated.push(profile);
        catalog.push(Object.freeze({ id: profile.id, displayName: profile.displayName }));
    }

    const defaultProfile = validated.find((profile) => profile.id === defaultProfileId);
    if (!defaultProfile) {
        throw new Error("Default companion profile is not registered");
    }

    let active = defaultProfile;
    if (requestedProfileId !== undefined && requestedProfileId !== "") {
        const requested = validated.find((profile) => profile.id === requestedProfileId);
        if (!requested) {
            active = defaultProfile;
        } else {
            active = requested;
        }
    }

    return {
        profile: active,
        catalog: Object.freeze(catalog),
    };
}
