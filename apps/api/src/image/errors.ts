export type ImageRejectedCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "unreadable"
  | "timeout"
  | "no_face"
  | "multiple_faces"
  | "face_too_small"
  | "invalid_faces";

/**
 * Thrown when an upload cannot be used. The message is written for end users
 * (Core returns it as HTTP 400 `{ error }`) and never contains image data.
 */
export class ImageRejectedError extends Error {
  readonly code: ImageRejectedCode;

  constructor(code: ImageRejectedCode, message: string) {
    super(message);
    this.name = "ImageRejectedError";
    this.code = code;
  }
}
