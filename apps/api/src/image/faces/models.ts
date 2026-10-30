import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InferenceSession } from "onnxruntime-node";

/** Open-weight models from the OpenCV model zoo, pinned by SHA-256 (matches the zoo's Git LFS oids). */
export const FACE_MODELS = {
  detector: {
    file: "face_detection_yunet_2023mar.onnx",
    url: "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
    sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    license: "MIT",
  },
  recognizer: {
    file: "face_recognition_sface_2021dec.onnx",
    url: "https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx",
    sha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    license: "Apache-2.0",
  },
} as const;

/** Embeddings from different models are not comparable; clients store this next to each embedding. */
export const FACE_MODEL_ID = "sface-2021dec";

/** apps/api/models/faces, from both src/image/faces and dist/image/faces. Override with FACE_MODELS_DIR. */
export function modelsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.FACE_MODELS_DIR || fileURLToPath(new URL("../../../models/faces/", import.meta.url));
}

export function modelsPresent(dir = modelsDir()): boolean {
  return Object.values(FACE_MODELS).every((m) => existsSync(path.join(dir, m.file)));
}

export class FaceModelsMissingError extends Error {
  constructor() {
    super("Face recognition is not set up on this server");
    this.name = "FaceModelsMissingError";
  }
}

export interface FaceSessions {
  detector: InferenceSession;
  recognizer: InferenceSession;
}

let loading: Promise<FaceSessions> | null = null;

/** Loads both models once, on first use, so servers that never use faces pay no memory for them. */
export function loadSessions(dir = modelsDir()): Promise<FaceSessions> {
  if (!loading) {
    loading = (async () => {
      if (!modelsPresent(dir)) throw new FaceModelsMissingError();
      const ort = await import("onnxruntime-node");
      const open = (file: string, sha256: string) => {
        const bytes = readFileSync(path.join(dir, file));
        if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error(`${file} does not match its pinned checksum`);
        // Severity 3 = errors only; YuNet's export triggers a harmless initializer warning.
        return ort.InferenceSession.create(bytes, { logSeverityLevel: 3, intraOpNumThreads: 1, interOpNumThreads: 1 });
      };
      return {
        detector: await open(FACE_MODELS.detector.file, FACE_MODELS.detector.sha256),
        recognizer: await open(FACE_MODELS.recognizer.file, FACE_MODELS.recognizer.sha256),
      };
    })();
    // A failed load (missing files) may be fixed by downloading the models; allow a retry.
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
