import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorHandler } from "../src/http.js";
import { ImageRejectedError, prepareImage } from "../src/image/index.js";
import { REFERENCE_LANDMARKS, alignedFaceInput, estimateSimilarity, ALIGNED_SIZE } from "../src/image/faces/align.js";
import { DETECTOR_SIZE, decodeYunet, nonMaxSuppression, toYunetInput, type DetectedFace } from "../src/image/faces/detect.js";
import { createFaceRouter, recognizeFaces, enrollFace } from "../src/image/faces/index.js";
import { EMBEDDING_LENGTH, MAX_KNOWN_FACES, l2normalize, matchFaces, parseKnownFaces } from "../src/image/faces/match.js";
import { modelsPresent } from "../src/image/faces/models.js";

function emptyYunetOutputs() {
  const out: Record<string, { data: Float32Array }> = {};
  for (const s of [8, 16, 32]) {
    const n = (DETECTOR_SIZE / s) ** 2;
    out[`cls_${s}`] = { data: new Float32Array(n) };
    out[`obj_${s}`] = { data: new Float32Array(n) };
    out[`bbox_${s}`] = { data: new Float32Array(n * 4) };
    out[`kps_${s}`] = { data: new Float32Array(n * 10) };
  }
  return out;
}

function face(x: number, y: number, size: number, score: number): DetectedFace {
  const p = { x, y };
  return { x, y, width: size, height: size, landmarks: [p, p, p, p, p], score };
}

/** Orthogonal unit vectors: different seeds have similarity 0, like clearly different people. */
const unit = (seed: number) => l2normalize(Array.from({ length: EMBEDDING_LENGTH }, (_, i) => (i === seed ? 1 : 0)));

describe("decodeYunet", () => {
  it("decodes one anchor into a box and landmarks in input pixels", () => {
    const out = emptyYunetOutputs();
    const cols = DETECTOR_SIZE / 16;
    const i = 10 * cols + 12; // row 10, column 12 at stride 16
    out.cls_16!.data[i] = 0.95;
    out.obj_16!.data[i] = 0.95;
    out.bbox_16!.data.set([0.5, 0.5, Math.log(4), Math.log(5)], i * 4);
    out.kps_16!.data.set([0, 0, 1, 0, 0.5, 0.5, 0, 1, 1, 1], i * 10);

    const faces = decodeYunet(out, 0.9);
    expect(faces).toHaveLength(1);
    const f = faces[0]!;
    expect(f.score).toBeCloseTo(0.95);
    expect([f.x, f.y, f.width, f.height].map((v) => Math.round(v))).toEqual([200 - 32, 168 - 40, 64, 80]);
    expect(f.landmarks[0]).toEqual({ x: 192, y: 160 });
    expect(f.landmarks[2]).toEqual({ x: 200, y: 168 });
  });

  it("drops anchors below the score threshold", () => {
    const out = emptyYunetOutputs();
    out.cls_8!.data[5] = 0.8;
    out.obj_8!.data[5] = 0.8;
    expect(decodeYunet(out, 0.9)).toEqual([]);
  });

  it("keeps the best of overlapping boxes and separate faces", () => {
    const kept = nonMaxSuppression([face(0, 0, 100, 0.92), face(5, 5, 100, 0.97), face(300, 0, 100, 0.91)], 0.3);
    expect(kept.map((f) => f.score)).toEqual([0.97, 0.91]);
  });

  it("packs RGB into padded BGR planes", () => {
    const rgb = new Uint8Array([10, 20, 30]); // one pixel
    const input = toYunetInput(rgb, 1, 1);
    const plane = DETECTOR_SIZE * DETECTOR_SIZE;
    expect([input[0], input[plane], input[2 * plane]]).toEqual([30, 20, 10]);
    expect(input[1]).toBe(0);
  });
});

describe("alignment", () => {
  it("recovers a known rotation, scale and translation", () => {
    const t = { a: 1.8 * Math.cos(0.3), b: 1.8 * Math.sin(0.3), tx: 40, ty: -12 };
    // src = inverse of t applied to the reference points, so estimate(src -> reference) must return t.
    const det = t.a * t.a + t.b * t.b;
    const src = REFERENCE_LANDMARKS.map((p) => {
      const dx = p.x - t.tx;
      const dy = p.y - t.ty;
      return { x: (t.a * dx + t.b * dy) / det, y: (-t.b * dx + t.a * dy) / det };
    });
    const got = estimateSimilarity(src, REFERENCE_LANDMARKS);
    expect(got.a).toBeCloseTo(t.a, 6);
    expect(got.b).toBeCloseTo(t.b, 6);
    expect(got.tx).toBeCloseTo(t.tx, 6);
    expect(got.ty).toBeCloseTo(t.ty, 6);
  });

  it("is the identity when landmarks already sit on the reference", () => {
    const rgb = new Uint8Array(ALIGNED_SIZE * ALIGNED_SIZE * 3).map((_, i) => i % 251);
    const input = alignedFaceInput(rgb, ALIGNED_SIZE, ALIGNED_SIZE, REFERENCE_LANDMARKS);
    const plane = ALIGNED_SIZE * ALIGNED_SIZE;
    for (const [x, y] of [
      [0, 0],
      [56, 60],
      [111, 111],
    ] as const) {
      for (let ch = 0; ch < 3; ch++) expect(input[ch * plane + y * ALIGNED_SIZE + x]).toBeCloseTo(rgb[(y * ALIGNED_SIZE + x) * 3 + ch]!, 3);
    }
  });
});

describe("matchFaces", () => {
  const tom = { name: "Tom (son)", embedding: unit(1) };
  const ana = { name: "Ana (nurse)", embedding: unit(2) };

  it("names each face and each person at most once, best first", () => {
    const people = matchFaces([unit(2), unit(1), unit(1)], [tom, ana], 0.363);
    expect(people.map((p) => p.name).sort()).toEqual(["Ana (nurse)", "Tom (son)"]);
    expect(people.every((p) => p.similarity === 1)).toBe(true);
  });

  it("leaves faces below the threshold unnamed", () => {
    expect(matchFaces([unit(3)], [tom, ana], 0.363)).toEqual([]);
  });
});

describe("parseKnownFaces", () => {
  const valid = { name: " Tom (son) ", embedding: unit(1) };

  it("accepts a JSON string, trims names and re-normalises embeddings", () => {
    const scaled = { name: "Tom", embedding: unit(1).map((x) => x * 50) };
    const [a, b] = parseKnownFaces(JSON.stringify([valid, scaled]));
    expect(a!.name).toBe("Tom (son)");
    expect(Math.hypot(...b!.embedding)).toBeCloseTo(1, 6);
  });

  it("treats a missing field as no known faces", () => {
    expect(parseKnownFaces(undefined)).toEqual([]);
    expect(parseKnownFaces("")).toEqual([]);
  });

  it.each([
    ["bad JSON", "[{"],
    ["not a list", JSON.stringify({ name: "x" })],
    ["wrong length", JSON.stringify([{ name: "x", embedding: [1, 2, 3] }])],
    ["non-numbers", JSON.stringify([{ name: "x", embedding: Array(EMBEDDING_LENGTH).fill("1") }])],
    ["empty name", JSON.stringify([{ name: " ", embedding: unit(1) }])],
    ["long name", JSON.stringify([{ name: "x".repeat(61), embedding: unit(1) }])],
    ["too many", JSON.stringify(Array(MAX_KNOWN_FACES + 1).fill(valid))],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseKnownFaces(raw)).toThrow(ImageRejectedError);
  });
});

describe("face router", () => {
  let base = "";
  let close = () => {};
  const previousDir = process.env.FACE_MODELS_DIR;

  beforeAll(async () => {
    process.env.FACE_MODELS_DIR = mkdtempSync(path.join(tmpdir(), "no-face-models-"));
    const app = express();
    app.use("/api", createFaceRouter());
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    close = () => server.close();
  });

  afterAll(() => {
    close();
    if (previousDir === undefined) delete process.env.FACE_MODELS_DIR;
    else process.env.FACE_MODELS_DIR = previousDir;
  });

  const form = (fields: Record<string, string>, image = true) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    if (image) body.append("image", new Blob([readFileSync("../../fixtures/scenarios/hot-tea/image.jpg")], { type: "image/jpeg" }), "x.jpg");
    return body;
  };

  it("refuses enrollment without consent", async () => {
    for (const consent of [undefined, "yes", "false"]) {
      const res = await fetch(`${base}/faces/enroll`, { method: "POST", body: form(consent ? { consent } : {}) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Consent from the person in the photo is required" });
    }
  });

  it("requires an image", async () => {
    const res = await fetch(`${base}/faces/enroll`, { method: "POST", body: form({ consent: "true" }, false) });
    expect(res.status).toBe(400);
  });

  it("rejects malformed knownFaces with 400", async () => {
    const res = await fetch(`${base}/faces/identify`, { method: "POST", body: form({ knownFaces: "[{" }) });
    expect(res.status).toBe(400);
  });

  it("answers 503 when the models are not installed", async () => {
    const res = await fetch(`${base}/faces/enroll`, { method: "POST", body: form({ consent: "true" }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Face recognition is not set up on this server" });
  });
});

// Needs `npx tsx src/image/faces/download-models.ts`; skipped in CI where the weights are absent.
describe.skipIf(!modelsPresent())("with the face models", () => {
  const fixture = (name: string) => readFileSync(`../../fixtures/scenarios/${name}/image.jpg`);

  it("finds no faces in the scene fixtures", async () => {
    for (const name of ["hot-tea", "open-window"]) {
      const prepared = await prepareImage(fixture(name), "image/jpeg", { log: false });
      await expect(recognizeFaces(prepared.data, [{ name: "Tom", embedding: unit(1) }])).resolves.toEqual({ facesSeen: 0, people: [] });
    }
  });

  it("refuses to enroll a photo without a face", async () => {
    const err = await enrollFace(fixture("hot-tea"), "image/jpeg").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageRejectedError);
    expect((err as ImageRejectedError).code).toBe("no_face");
  });
});
