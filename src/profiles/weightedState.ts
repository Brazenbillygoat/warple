import { ORDINARY_ROLES, type OrdinaryRole } from "./types";

export function selectWeightedOrdinaryRole(
    weights: Readonly<Record<OrdinaryRole, number>>,
    randomValue: number,
): OrdinaryRole {
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
        throw new RangeError("randomValue must be in the range [0, 1)");
    }

    const total = ORDINARY_ROLES.reduce((sum, role) => sum + weights[role], 0);
    if (!Number.isFinite(total) || total <= 0) {
        throw new RangeError("ordinary state weights must have a positive finite total");
    }

    const target = randomValue * total;
    let cumulative = 0;
    for (const role of ORDINARY_ROLES) {
        cumulative += weights[role];
        if (target < cumulative) return role;
    }

    return ORDINARY_ROLES[ORDINARY_ROLES.length - 1];
}
