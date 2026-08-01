export interface Rectangle {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface OverlayGeometry {
    readonly generation: number;
    readonly scaleFactor: number;
    readonly monitor: Rectangle;
    readonly workArea: Rectangle;
}

const PARAMETER_NAMES = [
    "generation",
    "scaleFactor",
    "monitorX",
    "monitorY",
    "monitorWidth",
    "monitorHeight",
    "workAreaX",
    "workAreaY",
    "workAreaWidth",
    "workAreaHeight",
] as const;

function readNumber(params: URLSearchParams, name: (typeof PARAMETER_NAMES)[number]): number {
    const raw = params.get(name);
    if (raw === null || raw.trim() === "") throw new Error(`Missing startup geometry field: ${name}`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Invalid startup geometry field: ${name}`);
    return value;
}

export function readStartupGeneration(search: string): number {
    const value = Number(new URLSearchParams(search).get("generation"));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function parseOverlayGeometry(search: string): OverlayGeometry {
    const params = new URLSearchParams(search);
    for (const key of params.keys()) {
        if (!PARAMETER_NAMES.includes(key as (typeof PARAMETER_NAMES)[number])) {
            throw new Error(`Unsupported startup geometry field: ${key}`);
        }
    }

    const geometry: OverlayGeometry = {
        generation: readNumber(params, "generation"),
        scaleFactor: readNumber(params, "scaleFactor"),
        monitor: {
            x: readNumber(params, "monitorX"),
            y: readNumber(params, "monitorY"),
            width: readNumber(params, "monitorWidth"),
            height: readNumber(params, "monitorHeight"),
        },
        workArea: {
            x: readNumber(params, "workAreaX"),
            y: readNumber(params, "workAreaY"),
            width: readNumber(params, "workAreaWidth"),
            height: readNumber(params, "workAreaHeight"),
        },
    };

    if (!Number.isSafeInteger(geometry.generation) || geometry.generation <= 0) {
        throw new Error("Invalid startup generation");
    }
    if (geometry.scaleFactor <= 0 || geometry.scaleFactor > 8) {
        throw new Error("Invalid display scale factor");
    }
    if (
        geometry.monitor.width <= 0 ||
        geometry.monitor.height <= 0 ||
        geometry.monitor.width > 100_000 ||
        geometry.monitor.height > 100_000
    ) {
        throw new Error("Invalid monitor dimensions");
    }
    if (
        geometry.workArea.x < 0 ||
        geometry.workArea.y < 0 ||
        geometry.workArea.width <= 0 ||
        geometry.workArea.height <= 0 ||
        geometry.workArea.x + geometry.workArea.width > geometry.monitor.width ||
        geometry.workArea.y + geometry.workArea.height > geometry.monitor.height
    ) {
        throw new Error("Work area must remain inside the monitor bounds");
    }

    return Object.freeze({
        ...geometry,
        monitor: Object.freeze(geometry.monitor),
        workArea: Object.freeze(geometry.workArea),
    });
}
