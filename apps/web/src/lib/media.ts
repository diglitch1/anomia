export function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
}

export function captureFrame(video: HTMLVideoElement | null): Promise<Blob | null> {
  if (!video || !video.videoWidth || !video.videoHeight) return Promise.resolve(null);
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
}

export function isPermissionError(e: unknown) {
  return e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
}
