export interface VelocityVector {
    readonly x: number;
    readonly y: number;
}

const ZERO_VELOCITY: VelocityVector = Object.freeze({ x: 0, y: 0 });

export function calculateReleaseVelocity(
    pointerVelocity: VelocityVector,
    multiplier: number,
    maximumSpeed: number,
): VelocityVector {
    const { x, y } = pointerVelocity;
    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(multiplier) ||
        multiplier < 0 ||
        !Number.isFinite(maximumSpeed) ||
        maximumSpeed <= 0
    ) {
        return ZERO_VELOCITY;
    }

    const largestComponent = Math.max(Math.abs(x), Math.abs(y));
    if (largestComponent === 0 || multiplier === 0) return ZERO_VELOCITY;

    const normalizedX = x / largestComponent;
    const normalizedY = y / largestComponent;
    const normalizedMagnitude = Math.hypot(normalizedX, normalizedY);
    const speed = Math.min(largestComponent * normalizedMagnitude * multiplier, maximumSpeed);

    return {
        x: (normalizedX / normalizedMagnitude) * speed,
        y: (normalizedY / normalizedMagnitude) * speed,
    };
}
