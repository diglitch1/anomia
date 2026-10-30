import { performance } from "node:perf_hooks";
import type { Tensor } from "onnxruntime-node";
import sharp from "sharp";
import { ImageRejectedError } from "../errors.js";
import { prepareImage } from "../index.js";
import { Limiter } from "../limiter.js";
import { ALIGNED_SIZE, alignedFaceInput } from "./align.js";
import { DETECTOR_SIZE, decodeYunet, scaleFace, toYunetInput, type DetectedFace } from "./detect.js";
import { l2normalize, matchFaces, type KnownFace, type PersonInView } from "./match.js";
import { FACE_MODEL_ID, loadSessions, modelsPresent, type FaceSessions } from "./models.js";

export { FACE_MODEL_ID, FaceModelsMissingError } from "./models.js";
export { parseKnownFaces, type KnownFace, type PersonInView } from "./match.js";
export { createFaceRouter } from "./router.js";

/** OpenCV's defaults for YuNet and SFace. */
const DETECTION_SCORE = 0.9;
const MATCH_THRESHOLD = (() => {
  const raw = process.env.FACE_MATCH_THRESHOLD;
  const value = raw ? Number(raw) : 0.363;
  if (!(value > 0 && value < 1)) throw new Error(`FACE_MATCH_THRESHOLD must be between 0 and 1, got "${raw}"`);
  return value;
})();
/** Faces smaller than this (in the prepared image) are too blurry to recognise reliably. */
const MIN_FACE_PX = 40;
const MIN_ENROLL_FACE_PX = 80;
const MAX_FACES = 8;

// One model run at a time; onnxruntime already uses native threads per run.
const limiter = new Limiter(1);

interface Rgb {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Whether the model files are installed, so callers can skip face work cheaply. */
export function facesAvailable(): boolean {
  return modelsPresent();
}

async function decode(jpeg: Buffer): Promise<Rgb> {
  const { data, info } = await sharp(jpeg).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function detect(sessions: FaceSessions, jpeg: Buffer, img: Rgb): Promise<DetectedFace[]> {
  const scale = Math.min(DETECTOR_SIZE / img.width, DETECTOR_SIZE / img.height);
  const { data, info } = await sharp(jpeg)
    .removeAlpha()
    .resize(Math.round(img.width * scale), Math.round(img.height * scale), { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ort = await import("onnxruntime-node");
  const input = new ort.Tensor("float32", toYunetInput(data, info.width, info.height), [1, 3, DETECTOR_SIZE, DETECTOR_SIZE]);
  const outputs = (await sessions.detector.run({ [sessions.detector.inputNames[0]!]: input })) as Record<string, Tensor>;
  return decodeYunet(outputs as never, DETECTION_SCORE)
    .map((f) => scaleFace(f, 1 / scale))
    .sort((a, b) => b.width * b.height - a.width * a.height);
}

async function embed(sessions: FaceSessions, img: Rgb, face: DetectedFace): Promise<number[]> {
  const ort = await import("onnxruntime-node");
  const input = new ort.Tensor("float32", alignedFaceInput(img.data, img.width, img.height, face.landmarks), [1, 3, ALIGNED_SIZE, ALIGNED_SIZE]);
  const out = await sessions.recognizer.run({ [sessions.recognizer.inputNames[0]!]: input });
  return l2normalize(out[sessions.recognizer.outputNames[0]!]!.data as Float32Array);
}

function log(kind: string, startedAt: number, details: string) {
  // Counts and timing only: never names, embeddings or image data.
  console.info(`[faces] ${kind} ${details} took=${Math.round(performance.now() - startedAt)}ms`);
}

/**
 * Turns a consented photo of one person into a face embedding the client stores on the device.
 * The photo goes through prepareImage (limits, rotation, metadata removal) first and is never kept.
 */
export async function enrollFace(input: Buffer, mime: string): Promise<{ embedding: number[]; model: string }> {
  const prepared = await prepareImage(input, mime);
  const sessions = await loadSessions();
  return limiter.run(async () => {
    const startedAt = performance.now();
    const img = await decode(prepared.data);
    const faces = (await detect(sessions, prepared.data, img)).filter((f) => f.width >= MIN_FACE_PX);
    if (faces.length === 0) throw new ImageRejectedError("no_face", "No face was found. Take a clear photo of one face, looking at the camera.");
    if (faces.length > 1) throw new ImageRejectedError("multiple_faces", "More than one face was found. Take a photo of only one person.");
    if (faces[0]!.width < MIN_ENROLL_FACE_PX) throw new ImageRejectedError("face_too_small", "The face is too small. Move closer and try again.");
    const embedding = await embed(sessions, img, faces[0]!);
    log("enroll", startedAt, "faces=1");
    return { embedding: embedding.map((x) => Math.round(x * 1e5) / 1e5), model: FACE_MODEL_ID };
  });
}

/**
 * Finds the user's enrolled people in an image that already went through prepareImage.
 * Unknown faces are only counted, never described or embedded beyond this call.
 */
export async function recognizeFaces(prepared: Buffer, known: readonly KnownFace[]): Promise<{ facesSeen: number; people: PersonInView[] }> {
  const sessions = await loadSessions();
  return limiter.run(async () => {
    const startedAt = performance.now();
    const img = await decode(prepared);
    const faces = (await detect(sessions, prepared, img)).filter((f) => f.width >= MIN_FACE_PX).slice(0, MAX_FACES);
    const embeddings = known.length ? await Promise.all(faces.map((f) => embed(sessions, img, f))) : [];
    const people = matchFaces(embeddings, known, MATCH_THRESHOLD);
    log("recognize", startedAt, `faces=${faces.length} known=${known.length} matched=${people.length}`);
    return { facesSeen: faces.length, people };
  });
}
