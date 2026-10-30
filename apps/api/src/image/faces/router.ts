import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { HttpError } from "../../http.js";
import { ImageRejectedError, loadConfig, prepareImage } from "../index.js";
import { enrollFace, recognizeFaces } from "./index.js";
import { parseKnownFaces } from "./match.js";
import { FaceModelsMissingError } from "./models.js";

function toHttp(error: unknown): unknown {
  if (error instanceof ImageRejectedError) return new HttpError(400, error.message);
  if (error instanceof FaceModelsMissingError) return new HttpError(503, error.message);
  return error;
}

/**
 * POST /faces/enroll   multipart: image (JPEG of one person), consent="true"
 *                      -> { embedding: number[128], model } for the client to keep on the device
 * POST /faces/identify multipart: image, knownFaces (JSON [{name, embedding}])
 *                      -> { facesSeen, people: [{name, similarity}] }
 * Mounted at /api. Nothing is stored; embeddings and names are never logged.
 */
export function createFaceRouter(): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: loadConfig().maxInputBytes, fieldSize: 64 * 1024 },
  }).single("image");

  router.post("/faces/enroll", upload, async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Biometric data: the person in the photo must have agreed to be recognised.
      if ((req.body as { consent?: unknown } | undefined)?.consent !== "true") {
        throw new HttpError(400, "Consent from the person in the photo is required");
      }
      if (!req.file?.buffer.length) throw new HttpError(400, "image is required");
      res.setHeader("cache-control", "no-store");
      res.json(await enrollFace(req.file.buffer, req.file.mimetype));
    } catch (error) {
      next(toHttp(error));
    }
  });

  router.post("/faces/identify", upload, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const known = parseKnownFaces((req.body as { knownFaces?: unknown } | undefined)?.knownFaces);
      if (!req.file?.buffer.length) throw new HttpError(400, "image is required");
      const prepared = await prepareImage(req.file.buffer, req.file.mimetype);
      res.setHeader("cache-control", "no-store");
      res.json(await recognizeFaces(prepared.data, known));
    } catch (error) {
      next(toHttp(error));
    }
  });

  return router;
}
