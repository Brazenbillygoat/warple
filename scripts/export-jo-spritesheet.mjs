import { createHash } from "node:crypto";
import {
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const ASE_FILE_MAGIC = 0xa5e0;
const ASE_FRAME_MAGIC = 0xf1fa;
const CHUNK_OLD_PALETTE = 0x0004;
const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;
const CHUNK_PALETTE = 0x2019;
const SUPPORTED_CHUNKS = new Set([
    CHUNK_OLD_PALETTE,
    CHUNK_LAYER,
    CHUNK_CEL,
    CHUNK_PALETTE,
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const manifestPath = resolve(repositoryRoot, "art/companions/jo/source-manifest.json");

function fail(message) {
    throw new Error(`Jo spritesheet export failed: ${message}`);
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function assertRange(buffer, offset, length, label) {
    if (offset < 0 || length < 0 || offset + length > buffer.length) {
        fail(`${label} is outside the file bounds`);
    }
}

function readString(buffer, offset, end, label) {
    assertRange(buffer, offset, 2, `${label} length`);
    const length = buffer.readUInt16LE(offset);
    assertRange(buffer, offset + 2, length, label);
    if (offset + 2 + length > end) fail(`${label} exceeds its chunk`);
    return {
        value: buffer.toString("utf8", offset + 2, offset + 2 + length),
        next: offset + 2 + length,
    };
}

function parseLayer(buffer, payload, end) {
    assertRange(buffer, payload, 16, "layer chunk");
    const flags = buffer.readUInt16LE(payload);
    const type = buffer.readUInt16LE(payload + 2);
    const childLevel = buffer.readUInt16LE(payload + 4);
    const blendMode = buffer.readUInt16LE(payload + 10);
    const opacity = buffer[payload + 12];
    const { value: name } = readString(buffer, payload + 16, end, "layer name");

    if (type !== 0) fail(`layer ${name} is not an ordinary image layer`);
    if (childLevel !== 0) fail(`layer ${name} is nested`);
    if (blendMode !== 0) fail(`layer ${name} does not use normal blending`);

    return {
        name,
        visible: Boolean(flags & 1),
        opacity,
    };
}

function parseCel(buffer, payload, end, priorFrames) {
    assertRange(buffer, payload, 16, "cel chunk");
    const layerIndex = buffer.readUInt16LE(payload);
    const x = buffer.readInt16LE(payload + 2);
    const y = buffer.readInt16LE(payload + 4);
    const opacity = buffer[payload + 6];
    const type = buffer.readUInt16LE(payload + 7);
    const zIndex = buffer.readInt16LE(payload + 9);
    let width;
    let height;
    let pixels;

    if (zIndex !== 0) fail("nonzero cel z-index is unsupported");

    if (type === 1) {
        assertRange(buffer, payload + 16, 2, "linked cel");
        const linkedFrame = buffer.readUInt16LE(payload + 16);
        const linkedCel = priorFrames[linkedFrame]?.get(layerIndex);
        if (!linkedCel) fail(`linked cel references missing frame ${linkedFrame}`);
        ({ width, height, pixels } = linkedCel);
    } else if (type === 0 || type === 2) {
        assertRange(buffer, payload + 16, 4, "image cel dimensions");
        width = buffer.readUInt16LE(payload + 16);
        height = buffer.readUInt16LE(payload + 18);
        const encoded = buffer.subarray(payload + 20, end);
        pixels = type === 2 ? inflateSync(encoded) : encoded;
        const expectedLength = width * height * 4;
        if (pixels.length !== expectedLength) {
            fail(`cel contains ${pixels.length} bytes; expected ${expectedLength}`);
        }
    } else {
        fail(`unsupported cel type ${type}`);
    }

    return { layerIndex, x, y, opacity, width, height, pixels };
}

function compositeFrame(frame, layers, width, height, ignoredLayer) {
    const output = Buffer.alloc(width * height * 4);

    for (const cel of [...frame.cels].sort((left, right) => left.layerIndex - right.layerIndex)) {
        const layer = layers[cel.layerIndex];
        if (!layer) fail(`cel references unknown layer ${cel.layerIndex}`);
        if (layer.name === ignoredLayer) continue;
        if (!layer.visible) fail(`artwork layer ${layer.name} is hidden`);

        for (let sourceY = 0; sourceY < cel.height; sourceY += 1) {
            for (let sourceX = 0; sourceX < cel.width; sourceX += 1) {
                const sourceOffset = (sourceY * cel.width + sourceX) * 4;
                const sourceAlpha =
                    (cel.pixels[sourceOffset + 3] / 255) *
                    (cel.opacity / 255) *
                    (layer.opacity / 255);
                if (sourceAlpha === 0) continue;

                const targetX = cel.x + sourceX;
                const targetY = cel.y + sourceY;
                if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) {
                    fail(`nontransparent pixel from layer ${layer.name} leaves the canvas`);
                }

                const targetOffset = (targetY * width + targetX) * 4;
                const targetAlpha = output[targetOffset + 3] / 255;
                const combinedAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
                for (let channel = 0; channel < 3; channel += 1) {
                    output[targetOffset + channel] = Math.round(
                        (cel.pixels[sourceOffset + channel] * sourceAlpha +
                            output[targetOffset + channel] * targetAlpha * (1 - sourceAlpha)) /
                            combinedAlpha,
                    );
                }
                output[targetOffset + 3] = Math.round(combinedAlpha * 255);
            }
        }
    }

    return output;
}

function parseAseprite(buffer, expected, sourceConfig) {
    assertRange(buffer, 0, 128, "file header");
    if (buffer.readUInt32LE(0) !== buffer.length) fail(`${expected.file} has a file-size mismatch`);
    if (buffer.readUInt16LE(4) !== ASE_FILE_MAGIC) fail(`${expected.file} has invalid magic`);

    const frameCount = buffer.readUInt16LE(6);
    const width = buffer.readUInt16LE(8);
    const height = buffer.readUInt16LE(10);
    const colorDepth = buffer.readUInt16LE(12);
    if (frameCount !== expected.frames) fail(`${expected.file} frame count changed`);
    if (width !== sourceConfig.width || height !== sourceConfig.height) {
        fail(`${expected.file} canvas changed from ${sourceConfig.width} by ${sourceConfig.height}`);
    }
    if (colorDepth !== sourceConfig.colorDepth) fail(`${expected.file} is not RGBA`);

    const layers = [];
    const frames = [];
    const celsByFrame = [];
    let position = 128;

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        assertRange(buffer, position, 16, `frame ${frameIndex} header`);
        const frameStart = position;
        const frameBytes = buffer.readUInt32LE(position);
        const frameEnd = frameStart + frameBytes;
        if (buffer.readUInt16LE(position + 4) !== ASE_FRAME_MAGIC) {
            fail(`${expected.file} frame ${frameIndex} has invalid magic`);
        }
        if (frameEnd > buffer.length || frameBytes < 16) fail(`frame ${frameIndex} size is invalid`);

        const oldChunkCount = buffer.readUInt16LE(position + 6);
        const durationMs = buffer.readUInt16LE(position + 8);
        const newChunkCount = buffer.readUInt32LE(position + 12);
        const chunkCount = oldChunkCount === 0xffff ? newChunkCount : oldChunkCount;
        position += 16;
        const frame = { durationMs, cels: [] };
        const frameCels = new Map();

        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
            assertRange(buffer, position, 6, `frame ${frameIndex} chunk ${chunkIndex}`);
            const chunkBytes = buffer.readUInt32LE(position);
            const chunkType = buffer.readUInt16LE(position + 4);
            const chunkEnd = position + chunkBytes;
            if (chunkBytes < 6 || chunkEnd > frameEnd) fail(`chunk ${chunkIndex} size is invalid`);
            if (!SUPPORTED_CHUNKS.has(chunkType)) {
                fail(`unsupported chunk type 0x${chunkType.toString(16)}`);
            }

            if (chunkType === CHUNK_LAYER) {
                if (frameIndex !== 0) fail("layer definitions occur after the first frame");
                layers.push(parseLayer(buffer, position + 6, chunkEnd));
            } else if (chunkType === CHUNK_CEL) {
                const cel = parseCel(buffer, position + 6, chunkEnd, celsByFrame);
                if (frameCels.has(cel.layerIndex)) fail(`frame ${frameIndex} repeats a layer cel`);
                frame.cels.push(cel);
                frameCels.set(cel.layerIndex, cel);
            }
            position = chunkEnd;
        }

        if (position !== frameEnd) fail(`frame ${frameIndex} chunk sizes do not fill the frame`);
        frames.push(frame);
        celsByFrame.push(frameCels);
    }

    if (position !== buffer.length) fail(`${expected.file} has trailing data`);
    if (!layers.some((layer) => layer.name === sourceConfig.ignoredLayer)) {
        fail(`${expected.file} has no ${sourceConfig.ignoredLayer} layer`);
    }
    const durations = frames.map((frame) => frame.durationMs);
    if (JSON.stringify(durations) !== JSON.stringify(expected.durationsMs)) {
        fail(`${expected.file} frame durations changed`);
    }

    return {
        frames: frames.map((frame) => ({
            durationMs: frame.durationMs,
            pixels: compositeFrame(frame, layers, width, height, sourceConfig.ignoredLayer),
        })),
        width,
        height,
    };
}

function alphaBounds(frames, width, height) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (const frame of frames) {
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (frame.pixels[(y * width + x) * 4 + 3] === 0) continue;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }
    if (maxX < 0) fail("animation contains no visible pixels");
    return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
}

function alignmentOffset(alignment, bounds, runtime) {
    const scaled = {
        minX: bounds.minX * runtime.scale,
        minY: bounds.minY * runtime.scale,
        maxX: bounds.maxX * runtime.scale,
        maxY: bounds.maxY * runtime.scale,
    };
    switch (alignment) {
        case "floor":
            return { x: 0, y: runtime.cellHeight - 1 - scaled.maxY };
        case "ceiling":
            return { x: 0, y: -scaled.minY };
        case "right-wall":
            return { x: runtime.cellWidth - scaled.maxX, y: 0 };
        case "center":
            return { x: 0, y: 0 };
        default:
            fail(`unknown alignment ${alignment}`);
    }
}

function durationExpandedFrames(animation, role, runtime) {
    if (!role.expandTiming) return animation.frames.map((frame) => frame.pixels);
    const tickMs = 1000 / runtime.frameRate;
    return animation.frames.flatMap((frame) =>
        Array.from(
            { length: Math.max(1, Math.round(frame.durationMs / tickMs)) },
            () => frame.pixels,
        ),
    );
}

function copyScaledFrame(sheet, sheetWidth, frame, sourceWidth, sourceHeight, cell, offset, runtime) {
    for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
        for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
            const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
            if (frame[sourceOffset + 3] === 0) continue;
            for (let scaleY = 0; scaleY < runtime.scale; scaleY += 1) {
                for (let scaleX = 0; scaleX < runtime.scale; scaleX += 1) {
                    const targetX =
                        cell.x + sourceX * runtime.scale + scaleX + offset.x;
                    const targetY =
                        cell.y + sourceY * runtime.scale + scaleY + offset.y;
                    if (
                        targetX < cell.x ||
                        targetX >= cell.x + runtime.cellWidth ||
                        targetY < cell.y ||
                        targetY >= cell.y + runtime.cellHeight
                    ) {
                        fail("alignment clips a visible runtime pixel");
                    }
                    frame.copy(sheet, (targetY * sheetWidth + targetX) * 4, sourceOffset, sourceOffset + 4);
                }
            }
        }
    }
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const name = Buffer.from(type, "ascii");
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    name.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
    return chunk;
}

function encodePng(width, height, pixels) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const rowBytes = width * 4;
    const raw = Buffer.alloc((rowBytes + 1) * height);
    for (let y = 0; y < height; y += 1) {
        pixels.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
    }
    return Buffer.concat([
        PNG_SIGNATURE,
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(raw, { level: 9 })),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

function buildSpritesheet(manifest) {
    const sourceByName = new Map();
    for (const source of manifest.sources) {
        const sourcePath = resolve(repositoryRoot, manifest.source.directory, source.file);
        const buffer = readFileSync(sourcePath);
        if (sha256(buffer) !== source.sha256) fail(`${source.file} SHA-256 changed`);
        sourceByName.set(source.file, parseAseprite(buffer, source, manifest.source));
    }
    if (sourceByName.size !== manifest.sources.length) fail("source filenames are not unique");

    const width = manifest.runtime.columns * manifest.runtime.cellWidth;
    const height = manifest.runtime.rows * manifest.runtime.cellHeight;
    const sheet = Buffer.alloc(width * height * 4);
    const seenRoles = new Set();

    for (const role of manifest.roles) {
        if (seenRoles.has(role.role)) fail(`role ${role.role} is duplicated`);
        seenRoles.add(role.role);
        const animation = sourceByName.get(role.source);
        if (!animation) fail(`role ${role.role} references an unknown source`);
        const frames = durationExpandedFrames(animation, role, manifest.runtime);
        if (frames.length !== role.runtimeFrames) fail(`role ${role.role} runtime frame count changed`);
        if (frames.length > manifest.runtime.columns) fail(`role ${role.role} exceeds the sheet columns`);
        if (role.row < 1 || role.row > manifest.runtime.rows) fail(`role ${role.role} has an invalid row`);
        const offset = alignmentOffset(
            role.alignment,
            alphaBounds(animation.frames, animation.width, animation.height),
            manifest.runtime,
        );
        frames.forEach((frame, column) =>
            copyScaledFrame(
                sheet,
                width,
                frame,
                animation.width,
                animation.height,
                {
                    x: column * manifest.runtime.cellWidth,
                    y: (role.row - 1) * manifest.runtime.cellHeight,
                },
                offset,
                manifest.runtime,
            ),
        );
    }

    if (seenRoles.size !== manifest.runtime.rows) fail("role count does not match the sheet rows");
    return encodePng(width, height, sheet);
}

function verifyGuideExclusion() {
    const output = compositeFrame(
        {
            cels: [
                { layerIndex: 0, x: 0, y: 0, opacity: 255, width: 1, height: 1, pixels: Buffer.from([255, 0, 255, 255]) },
                { layerIndex: 1, x: 1, y: 0, opacity: 255, width: 1, height: 1, pixels: Buffer.from([10, 20, 30, 255]) },
            ],
        },
        [
            { name: "Guides", visible: true, opacity: 255 },
            { name: "Artwork", visible: true, opacity: 255 },
        ],
        2,
        1,
        "Guides",
    );
    if (!output.equals(Buffer.from([0, 0, 0, 0, 10, 20, 30, 255]))) {
        fail("guide-layer exclusion self-test did not preserve only artwork pixels");
    }
}

if (process.argv.includes("--self-test-guides")) {
    verifyGuideExclusion();
    process.stdout.write("Jo guide-layer exclusion verified\n");
} else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const output = buildSpritesheet(manifest);
    const outputHash = sha256(output);
    const outputPath = resolve(repositoryRoot, manifest.runtime.output);
    const checkOnly = process.argv.includes("--check");

    if (manifest.runtime.sha256 && outputHash !== manifest.runtime.sha256) {
        fail(`generated PNG SHA-256 ${outputHash} does not match the manifest`);
    }

    if (checkOnly) {
        const existing = readFileSync(outputPath);
        if (!existing.equals(output)) fail("checked-in PNG is not the deterministic export");
        process.stdout.write(`Jo spritesheet verified: ${outputHash}\n`);
    } else {
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, output);
        process.stdout.write(`Jo spritesheet written: ${outputPath}\nSHA-256: ${outputHash}\n`);
    }
}
