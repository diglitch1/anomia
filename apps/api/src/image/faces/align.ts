import type { Point } from "./detect.js";

export const ALIGNED_SIZE = 112;

/** ArcFace/SFace reference landmarks in a 112x112 crop, same order as YuNet's landmarks. */
export const REFERENCE_LANDMARKS: readonly Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

/** Similarity transform dst = [a -b; b a]·src + t. */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/** Least-squares similarity (rotation, uniform scale, translation) mapping `src` onto `dst`. */
export function estimateSimilarity(src: readonly Point[], dst: readonly Point[]): Similarity {
  const n = src.length;
  const mean = (ps: readonly Point[]) => ({ x: ps.reduce((s, p) => s + p.x, 0) / n, y: ps.reduce((s, p) => s + p.y, 0) / n });
  const ms = mean(src);
  const md = mean(dst);
  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i]!.x - ms.x;
    const sy = src[i]!.y - ms.y;
    const dx = dst[i]!.x - md.x;
    const dy = dst[i]!.y - md.y;
    dot += sx * dx + sy * dy;
    cross += sx * dy - sy * dx;
    norm += sx * sx + sy * sy;
  }
  if (norm === 0) throw new Error("degenerate landmarks");
  const a = dot / norm;
  const b = cross / norm;
  return { a, b, tx: md.x - (a * ms.x - b * ms.y), ty: md.y - (b * ms.x + a * ms.y) };
}

/**
 * Warps the face into a 112x112 RGB crop with bilinear sampling (black outside the image),
 * as SFace's float NCHW input in RGB order with 0-255 values.
 */
export function alignedFaceInput(rgb: Uint8Array, width: number, height: number, landmarks: readonly Point[]): Float32Array {
  const { a, b, tx, ty } = estimateSimilarity(landmarks, REFERENCE_LANDMARKS);
  // Inverse of [a -b; b a]: 1/(a²+b²) · [a b; -b a]
  const det = a * a + b * b;
  const plane = ALIGNED_SIZE * ALIGNED_SIZE;
  const out = new Float32Array(3 * plane);
  const px = (x: number, y: number, ch: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : rgb[(y * width + x) * 3 + ch]!);
  for (let v = 0; v < ALIGNED_SIZE; v++) {
    for (let u = 0; u < ALIGNED_SIZE; u++) {
      const du = u - tx;
      const dv = v - ty;
      const sx = (a * du + b * dv) / det;
      const sy = (-b * du + a * dv) / det;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const top = px(x0, y0, ch) * (1 - fx) + px(x0 + 1, y0, ch) * fx;
        const bottom = px(x0, y0 + 1, ch) * (1 - fx) + px(x0 + 1, y0 + 1, ch) * fx;
        out[ch * plane + v * ALIGNED_SIZE + u] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}
