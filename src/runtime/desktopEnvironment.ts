import type { OverlayGeometry, Rectangle } from "./geometry";

const MAX_RECTANGLE_SIZE = 100_000;
const MAX_STRING_LENGTH = 32_768;
const MAX_ITEMS = 2_048;
const MAX_PROPERTIES = 512;
const MAX_PROPERTY_ELEMENTS = 256;

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface DesktopItemAttributes {
    readonly fileSystem: boolean;
    readonly folder: boolean;
    readonly shortcut: boolean;
    readonly hidden: boolean;
    readonly readOnly: boolean;
    readonly shared: boolean;
    readonly copyable: boolean;
    readonly movable: boolean;
    readonly linkable: boolean;
}

export interface ShortcutSummary {
    readonly target?: string;
    readonly arguments?: string;
    readonly workingDirectory?: string;
    readonly description?: string;
    readonly iconLocation?: string;
}

export interface DesktopItemSummary {
    readonly id: string;
    readonly displayName: string;
    readonly editingName: string;
    readonly position: Point;
    readonly bounds: Rectangle;
    readonly selected: boolean;
    readonly focused: boolean;
    readonly sourceOrder: number;
    readonly shellKinds: readonly string[];
    readonly fileSystemPath?: string;
    readonly parsingPath: string;
    readonly shortcut?: ShortcutSummary;
    readonly attributes: DesktopItemAttributes;
}

export interface ForegroundWindowCandidate {
    readonly id: string;
    readonly bounds: Rectangle;
}

export interface DesktopEnvironmentSnapshot {
    readonly sequence: number;
    readonly foregroundWindow?: ForegroundWindowCandidate;
    readonly desktopShellActive: boolean;
    readonly desktopItems: readonly DesktopItemSummary[];
}

export type PropertyValue = boolean | number | string | readonly boolean[] | readonly number[] | readonly string[];

export interface DesktopPropertyRecord {
    readonly canonicalName: string;
    readonly displayName?: string;
    readonly value: PropertyValue;
    readonly formattedValue?: string;
}

export interface DesktopItemDetails {
    readonly itemId: string;
    readonly properties: readonly DesktopPropertyRecord[];
}

type UnknownRecord = Record<string, unknown>;

export function validateDesktopEnvironmentResponse(
    value: unknown,
    geometry: OverlayGeometry,
): DesktopEnvironmentSnapshot | undefined {
    const response = asRecord(value);
    if (!response || response.available !== true) return undefined;
    const sequence = safePositiveInteger(response.sequence);
    if (!sequence || typeof response.desktopShellActive !== "boolean") return undefined;
    if (!Array.isArray(response.desktopItems) || response.desktopItems.length > MAX_ITEMS) {
        return undefined;
    }

    const foregroundWindow = validateForegroundWindow(response.foregroundWindow, geometry);
    if (response.foregroundWindow != null && !foregroundWindow) return undefined;

    const desktopItems: DesktopItemSummary[] = [];
    for (const candidate of response.desktopItems) {
        const item = validateDesktopItem(candidate, geometry);
        if (item === "invalid") return undefined;
        if (item) desktopItems.push(item);
    }

    return Object.freeze({
        sequence,
        foregroundWindow,
        desktopShellActive: response.desktopShellActive,
        desktopItems: Object.freeze(desktopItems),
    });
}

export function validateDesktopItemDetails(
    value: unknown,
    expectedItemId: string,
): DesktopItemDetails | undefined {
    const details = asRecord(value);
    if (!details || details.itemId !== expectedItemId || !Array.isArray(details.properties)) {
        return undefined;
    }
    if (details.properties.length > MAX_PROPERTIES) return undefined;

    const properties: DesktopPropertyRecord[] = [];
    for (const candidate of details.properties) {
        const property = asRecord(candidate);
        const canonicalName = property && boundedString(property.canonicalName, false);
        if (!property || !canonicalName || !("value" in property)) return undefined;
        const displayName = optionalString(property.displayName);
        const formattedValue = optionalString(property.formattedValue);
        if (displayName === "invalid" || formattedValue === "invalid") return undefined;
        const propertyValue = validatePropertyValue(property.value);
        if (propertyValue === undefined) return undefined;
        properties.push(
            Object.freeze({
                canonicalName,
                displayName,
                value: propertyValue,
                formattedValue,
            }),
        );
    }

    return Object.freeze({ itemId: expectedItemId, properties: Object.freeze(properties) });
}

function validateForegroundWindow(
    value: unknown,
    geometry: OverlayGeometry,
): ForegroundWindowCandidate | undefined {
    if (value == null) return undefined;
    const candidate = asRecord(value);
    const id = candidate && boundedString(candidate.id, false, 128);
    const physicalBounds = candidate && validateRectangle(candidate.bounds);
    if (!candidate || !id || !physicalBounds) return undefined;
    const localBounds = toOverlayLocalRectangle(physicalBounds, geometry);
    const clipped = intersectRectangles(localBounds, geometry.workArea);
    if (!clipped) return undefined;
    return Object.freeze({ id, bounds: Object.freeze(clipped) });
}

function validateDesktopItem(
    value: unknown,
    geometry: OverlayGeometry,
): DesktopItemSummary | "invalid" | undefined {
    const item = asRecord(value);
    if (!item) return "invalid";
    const id = boundedString(item.id, false, 128);
    const displayName = boundedString(item.displayName, true);
    const editingName = boundedString(item.editingName, true);
    const parsingPath = boundedString(item.parsingPath, false);
    const position = validatePoint(item.position);
    const bounds = validateRectangle(item.bounds);
    const sourceOrder = safeNonNegativeInteger(item.sourceOrder);
    const shellKinds = validateStringArray(item.shellKinds, 32);
    const attributes = validateAttributes(item.attributes);
    const fileSystemPath = optionalString(item.fileSystemPath);
    const shortcut = validateShortcut(item.shortcut);
    if (
        !id ||
        displayName === undefined ||
        editingName === undefined ||
        !parsingPath ||
        !position ||
        !bounds ||
        sourceOrder === undefined ||
        !shellKinds ||
        !attributes ||
        fileSystemPath === "invalid" ||
        shortcut === "invalid" ||
        typeof item.selected !== "boolean" ||
        typeof item.focused !== "boolean"
    ) {
        return "invalid";
    }

    const localPosition = toOverlayLocalPoint(position, geometry);
    const localBounds = toOverlayLocalRectangle(bounds, geometry);
    if (!intersectRectangles(localBounds, geometry.workArea)) return undefined;
    return Object.freeze({
        id,
        displayName,
        editingName,
        position: Object.freeze(localPosition),
        bounds: Object.freeze(localBounds),
        selected: item.selected,
        focused: item.focused,
        sourceOrder,
        shellKinds: Object.freeze(shellKinds),
        fileSystemPath,
        parsingPath,
        shortcut,
        attributes,
    });
}

function validateAttributes(value: unknown): DesktopItemAttributes | undefined {
    const attributes = asRecord(value);
    if (!attributes) return undefined;
    const names = [
        "fileSystem",
        "folder",
        "shortcut",
        "hidden",
        "readOnly",
        "shared",
        "copyable",
        "movable",
        "linkable",
    ] as const;
    if (names.some((name) => typeof attributes[name] !== "boolean")) return undefined;
    return Object.freeze(Object.fromEntries(names.map((name) => [name, attributes[name]]))) as unknown as DesktopItemAttributes;
}

function validateShortcut(value: unknown): ShortcutSummary | "invalid" | undefined {
    if (value == null) return undefined;
    const shortcut = asRecord(value);
    if (!shortcut) return "invalid";
    const target = optionalString(shortcut.target);
    const argumentsValue = optionalString(shortcut.arguments);
    const workingDirectory = optionalString(shortcut.workingDirectory);
    const description = optionalString(shortcut.description);
    const iconLocation = optionalString(shortcut.iconLocation);
    if ([target, argumentsValue, workingDirectory, description, iconLocation].includes("invalid")) {
        return "invalid";
    }
    return Object.freeze({
        target: target as string | undefined,
        arguments: argumentsValue as string | undefined,
        workingDirectory: workingDirectory as string | undefined,
        description: description as string | undefined,
        iconLocation: iconLocation as string | undefined,
    });
}

function validatePropertyValue(value: unknown): PropertyValue | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value === "string") return boundedString(value, true);
    if (!Array.isArray(value) || value.length > MAX_PROPERTY_ELEMENTS) return undefined;
    if (value.every((entry) => typeof entry === "boolean")) return Object.freeze([...value]);
    if (value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
        return Object.freeze([...value]);
    }
    if (value.every((entry) => typeof entry === "string" && entry.length <= MAX_STRING_LENGTH)) {
        return Object.freeze([...value]);
    }
    return undefined;
}

function validatePoint(value: unknown): Point | undefined {
    const point = asRecord(value);
    if (!point || !finiteNumber(point.x) || !finiteNumber(point.y)) return undefined;
    return { x: point.x, y: point.y };
}

function validateRectangle(value: unknown): Rectangle | undefined {
    const rectangle = asRecord(value);
    if (
        !rectangle ||
        !finiteNumber(rectangle.x) ||
        !finiteNumber(rectangle.y) ||
        !finiteNumber(rectangle.width) ||
        !finiteNumber(rectangle.height) ||
        rectangle.width <= 0 ||
        rectangle.height <= 0 ||
        rectangle.width > MAX_RECTANGLE_SIZE ||
        rectangle.height > MAX_RECTANGLE_SIZE
    ) {
        return undefined;
    }
    return {
        x: rectangle.x,
        y: rectangle.y,
        width: rectangle.width,
        height: rectangle.height,
    };
}

function toOverlayLocalPoint(point: Point, geometry: OverlayGeometry): Point {
    return {
        x: point.x / geometry.scaleFactor - geometry.monitor.x,
        y: point.y / geometry.scaleFactor - geometry.monitor.y,
    };
}

function toOverlayLocalRectangle(rectangle: Rectangle, geometry: OverlayGeometry): Rectangle {
    const origin = toOverlayLocalPoint(rectangle, geometry);
    return {
        x: origin.x,
        y: origin.y,
        width: rectangle.width / geometry.scaleFactor,
        height: rectangle.height / geometry.scaleFactor,
    };
}

function intersectRectangles(a: Rectangle, b: Rectangle): Rectangle | undefined {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    if (right <= left || bottom <= top) return undefined;
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function validateStringArray(value: unknown, maximumItems: number): string[] | undefined {
    if (!Array.isArray(value) || value.length > maximumItems) return undefined;
    if (!value.every((entry) => boundedString(entry, false))) return undefined;
    return [...value];
}

function optionalString(value: unknown): string | "invalid" | undefined {
    if (value == null) return undefined;
    return boundedString(value, true) ?? "invalid";
}

function boundedString(value: unknown, allowEmpty: boolean, maximum = MAX_STRING_LENGTH): string | undefined {
    if (typeof value !== "string" || value.length > maximum || (!allowEmpty && value.length === 0)) {
        return undefined;
    }
    return value;
}

function safePositiveInteger(value: unknown): number | undefined {
    return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
    return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

function finiteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function asRecord(value: unknown): UnknownRecord | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as UnknownRecord)
        : undefined;
}
