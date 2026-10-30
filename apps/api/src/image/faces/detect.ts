export interface Point {
  x: number;
  y: number;
}

export interface DetectedFace {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Right eye, left eye, nose tip, right and left mouth corner (image left first). */
  landmarks: [Point, Point, Point, Point, Point];
  score: number;
}

/** YuNet 2023mar has a fixed 640x640 input. */
export const DETECTOR_SIZE = 640;
const STRIDES = [8, 16, 32] as const;

export type YunetOutputs = Record<string, { data: ArrayLike<number> }>;

/**
 * Decodes YuNet's anchor-free outputs into faces in input-pixel coordinates.
 * Port of OpenCV's FaceDetectorYN::postProcess for the 2023mar model.
 */
export function decodeYunet(outputs: YunetOutputs, scoreThreshold: number, size = DETECTOR_SIZE): DetectedFace[] {
  const faces: DetectedFace[] = [];
  for (const stride of STRIDES) {
    const cols = Math.floor(size / stride);
    const rows = Math.floor(size / stride);
    const cls = outputs[`cls_${stride}`]!.data;
    const obj = outputs[`obj_${stride}`]!.data;
    const bbox = outputs[`bbox_${stride}`]!.data;
    const kps = outputs[`kps_${stride}`]!.data;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const clamp = (v: number) => Math.min(1, Math.max(0, v));
        const score = Math.sqrt(clamp(cls[i]!) * clamp(obj[i]!));
        if (score < scoreThreshold) continue;
        const cx = (c + bbox[i * 4]!) * stride;
        const cy = (r + bbox[i * 4 + 1]!) * stride;
        const width = Math.exp(bbox[i * 4 + 2]!) * stride;
        const height = Math.exp(bbox[i * 4 + 3]!) * stride;
        const landmarks = Array.from({ length: 5 }, (_, n) => ({
          x: (kps[i * 10 + 2 * n]! + c) * stride,
          y: (kps[i * 10 + 2 * n + 1]! + r) * stride,
        })) as DetectedFace["landmarks"];
        faces.push({ x: cx - width / 2, y: cy - height / 2, width, height, landmarks, score });
      }
    }
  }
  return nonMaxSuppression(faces, 0.3);
}

function iou(a: DetectedFace, b: DetectedFace): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.width * a.height + b.width * b.height - inter);
}

export function nonMaxSuppression(faces: DetectedFace[], threshold: number): DetectedFace[] {
  const kept: DetectedFace[] = [];
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k, face) <= threshold)) kept.push(face);
  }
  return kept;
}

/**
 * Copies an RGB image (already scaled to fit 640x640) into YuNet's BGR float NCHW input,
 * padded right/bottom. Map detections back with `scaleFace(face, 1 / scale)`.
 */
export function toYunetInput(rgb: Uint8Array, width: number, height: number): Float32Array {
  const plane = DETECTOR_SIZE * DETECTOR_SIZE;
  const out = new Float32Array(3 * plane); // zero padding right/bottom, like OpenCV's padWithDivisor
  for (let y = 0; y < Math.min(height, DETECTOR_SIZE); y++) {
    for (let x = 0; x < Math.min(width, DETECTOR_SIZE); x++) {
      const src = (y * width + x) * 3;
      const dst = y * DETECTOR_SIZE + x;
      out[dst] = rgb[src + 2]!; // B
      out[plane + dst] = rgb[src + 1]!; // G
      out[2 * plane + dst] = rgb[src]!; // R
    }
  }
  return out;
}

export function scaleFace(face: DetectedFace, factor: number): DetectedFace {
  return {
    x: face.x * factor,
    y: face.y * factor,
    width: face.width * factor,
    height: face.height * factor,
    landmarks: face.landmarks.map((p) => ({ x: p.x * factor, y: p.y * factor })) as DetectedFace["landmarks"],
    score: face.score,
  };
}
