import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BUILT_IN_ARTWORK } from "../artwork";
import { JO_PROFILE } from "../jo";

interface JoSourceManifest {
    readonly source: {
        readonly directory: string;
    };
    readonly runtime: {
        readonly output: string;
        readonly cellWidth: number;
        readonly cellHeight: number;
        readonly columns: number;
        readonly rows: number;
        readonly sha256: string;
    };
    readonly sources: readonly {
        readonly file: string;
        readonly sha256: string;
    }[];
    readonly roles: readonly {
        readonly role: string;
        readonly row: number;
        readonly runtimeFrames: number;
    }[];
}

const repositoryRoot = process.cwd();
const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, "art/companions/jo/source-manifest.json"), "utf8"),
) as JoSourceManifest;

function sha256(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function decodeExporterPng(png: Buffer): Buffer {
    const compressed: Buffer[] = [];
    let offset = 8;
    while (offset < png.length) {
        const length = png.readUInt32BE(offset);
        const type = png.toString("ascii", offset + 4, offset + 8);
        if (type === "IDAT") compressed.push(png.subarray(offset + 8, offset + 8 + length));
        offset += 12 + length;
    }

    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const rowBytes = width * 4;
    const filtered = inflateSync(Buffer.concat(compressed));
    const pixels = Buffer.alloc(rowBytes * height);
    for (let y = 0; y < height; y += 1) {
        const rowOffset = y * (rowBytes + 1);
        expect(filtered[rowOffset], `PNG row ${y} filter`).toBe(0);
        filtered.copy(pixels, y * rowBytes, rowOffset + 1, rowOffset + 1 + rowBytes);
    }
    return pixels;
}

function roleAlphaBounds(pixels: Buffer, roleName: string) {
    const role = manifest.roles.find((candidate) => candidate.role === roleName);
    if (!role) throw new Error(`Missing manifest role ${roleName}`);
    const sheetWidth = manifest.runtime.columns * manifest.runtime.cellWidth;
    let minX = manifest.runtime.cellWidth;
    let minY = manifest.runtime.cellHeight;
    let maxX = -1;
    let maxY = -1;
    for (let frame = 0; frame < role.runtimeFrames; frame += 1) {
        for (let y = 0; y < manifest.runtime.cellHeight; y += 1) {
            for (let x = 0; x < manifest.runtime.cellWidth; x += 1) {
                const sheetX = frame * manifest.runtime.cellWidth + x;
                const sheetY = (role.row - 1) * manifest.runtime.cellHeight + y;
                if (pixels[(sheetY * sheetWidth + sheetX) * 4 + 3] === 0) continue;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }
    return { minX, minY, maxX, maxY };
}

describe("Jo artwork package", () => {
    it("preserves every approved source at its recorded SHA-256", () => {
        expect(manifest.sources).toHaveLength(17);
        for (const source of manifest.sources) {
            const bytes = readFileSync(resolve(repositoryRoot, manifest.source.directory, source.file));
            expect(sha256(bytes), source.file).toBe(source.sha256);
        }
    });

    it("reproduces the checked-in spritesheet from the approved sources", () => {
        expect(() =>
            execFileSync(process.execPath, ["scripts/export-jo-spritesheet.mjs", "--check"], {
                cwd: repositoryRoot,
                stdio: "pipe",
            }),
        ).not.toThrow();
    });

    it("excludes guide-layer pixels while retaining artwork pixels", () => {
        expect(() =>
            execFileSync(process.execPath, ["scripts/export-jo-spritesheet.mjs", "--self-test-guides"], {
                cwd: repositoryRoot,
                stdio: "pipe",
            }),
        ).not.toThrow();
    });

    it("records PNG dimensions and hashes that match the registered profile", () => {
        const png = readFileSync(resolve(repositoryRoot, manifest.runtime.output));
        expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(png.readUInt32BE(16)).toBe(manifest.runtime.columns * manifest.runtime.cellWidth);
        expect(png.readUInt32BE(20)).toBe(manifest.runtime.rows * manifest.runtime.cellHeight);
        expect(sha256(png)).toBe(manifest.runtime.sha256);
        expect(BUILT_IN_ARTWORK[JO_PROFILE.artworkId]).toMatchObject({
            width: png.readUInt32BE(16),
            height: png.readUInt32BE(20),
        });
    });

    it("expands the runtime sheet to fifteen rows at 3328 by 1920", () => {
        expect(manifest.runtime.rows).toBe(15);
        expect(manifest.runtime.columns).toBe(26);
        expect(manifest.runtime.cellWidth * manifest.runtime.columns).toBe(3328);
        expect(manifest.runtime.cellHeight * manifest.runtime.rows).toBe(1920);
        const roleNames = manifest.roles.map((role) => role.role);
        expect(roleNames).toEqual([
            "stand",
            "walk",
            "sit",
            "greet",
            "crawl",
            "climb",
            "jump",
            "fall",
            "drag",
            "mj-spin",
            "front-idle",
            "sit-down",
            "stand-up",
            "crawl-hold",
            "climb-hold",
        ]);
    });

    it("keeps manifest role rows and frame counts synchronized with Jo's profile", () => {
        for (const role of manifest.roles) {
            expect(JO_PROFILE.animations[role.role as keyof typeof JO_PROFILE.animations]).toEqual({
                row: role.row,
                frames: role.runtimeFrames,
            });
        }
    });

    it("anchors contact animations to their intended runtime edges without clipping", () => {
        const png = readFileSync(resolve(repositoryRoot, manifest.runtime.output));
        const pixels = decodeExporterPng(png);

        for (const role of ["stand", "walk", "sit", "greet", "fall", "mj-spin"]) {
            expect(roleAlphaBounds(pixels, role).maxY, `${role} floor anchor`).toBe(126);
        }
        expect(roleAlphaBounds(pixels, "crawl").minY).toBe(0);
        expect(roleAlphaBounds(pixels, "climb").maxX).toBe(127);
    });

    it("anchors the front idle, transition, and hold rows to their authored edges", () => {
        const png = readFileSync(resolve(repositoryRoot, manifest.runtime.output));
        const pixels = decodeExporterPng(png);

        for (const role of ["front-idle", "sit-down", "stand-up"]) {
            expect(roleAlphaBounds(pixels, role).maxY, `${role} floor anchor`).toBe(126);
        }
        expect(roleAlphaBounds(pixels, "crawl-hold").minY).toBe(0);
        expect(roleAlphaBounds(pixels, "climb-hold").maxX).toBe(127);
    });
});
