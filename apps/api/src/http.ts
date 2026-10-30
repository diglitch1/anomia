import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Logs request metadata only. Bodies, query strings and headers never reach the log. */
export const requestLog: RequestHandler = (req, res, next) => {
  const start = performance.now();
  const route = req.path;
  res.on("finish", () => {
    const ms = Math.round(performance.now() - start);
    console.log(`${req.method} ${route} ${res.statusCode} ${ms}ms`);
  });
  next();
};

/** Safe description of a provider failure: never includes messages, which could echo user input. */
export function describeError(error: unknown): string {
  const { name, status, code } = (error ?? {}) as { name?: string; status?: number; code?: string };
  return [name ?? "Error", status, code].filter(Boolean).join(" ");
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "Upload too large" : "Invalid upload" });
    return;
  }
  const status = (error as { status?: number }).status;
  if (status === 413 || status === 400) {
    res.status(status).json({ error: status === 413 ? "Request too large" : "Invalid request body" });
    return;
  }
  console.error(`request failed: ${describeError(error)}`);
  res.status(500).json({ error: "Internal server error" });
};
