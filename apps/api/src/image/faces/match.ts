import { ImageRejectedError } from "../errors.js";

export const EMBEDDING_LENGTH = 128;
export const MAX_KNOWN_FACES = 20;
const MAX_NAME_LENGTH = 60;

/** A person the user enrolled on their device. The server never stores these. */
export interface KnownFace {
  /** Free text chosen by the user, e.g. "Tom (son)". */
  name: string;
  embedding: number[];
}

export interface PersonInView {
  name: string;
  /** Cosine similarity, 0-1; SFace's suggested match threshold is 0.363. */
  similarity: number;
}

export function l2normalize(v: ArrayLike<number>): number[] {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const norm = Math.sqrt(sum) || 1;
  return Array.from(v, (x) => x / norm);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

/**
 * Names each face at most once and each person at most once, best similarities first.
 * Faces below the threshold stay unnamed.
 */
export function matchFaces(faces: readonly number[][], known: readonly KnownFace[], threshold: number): PersonInView[] {
  const pairs: Array<{ face: number; person: number; similarity: number }> = [];
  faces.forEach((f, face) =>
    known.forEach((k, person) => {
      const similarity = cosine(f, k.embedding);
      if (similarity >= threshold) pairs.push({ face, person, similarity });
    }),
  );
  pairs.sort((x, y) => y.similarity - x.similarity);
  const usedFaces = new Set<number>();
  const usedPeople = new Set<number>();
  const result: PersonInView[] = [];
  for (const p of pairs) {
    if (usedFaces.has(p.face) || usedPeople.has(p.person)) continue;
    usedFaces.add(p.face);
    usedPeople.add(p.person);
    result.push({ name: known[p.person]!.name, similarity: Math.round(p.similarity * 100) / 100 });
  }
  return result;
}

const invalid = () =>
  new ImageRejectedError("invalid_faces", `knownFaces must be a list of up to ${MAX_KNOWN_FACES} {name, embedding} entries from /api/faces/enroll.`);

/** Validates client-supplied known faces (a JSON string or an already parsed value). */
export function parseKnownFaces(raw: unknown): KnownFace[] {
  if (raw === undefined || raw === null || raw === "") return [];
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw invalid();
    }
  }
  if (!Array.isArray(value) || value.length > MAX_KNOWN_FACES) throw invalid();
  return value.map((entry: unknown) => {
    const { name, embedding } = (entry ?? {}) as { name?: unknown; embedding?: unknown };
    if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME_LENGTH) throw invalid();
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_LENGTH) throw invalid();
    if (!embedding.every((x) => typeof x === "number" && Number.isFinite(x))) throw invalid();
    // Re-normalise so a client cannot inflate similarities with a scaled vector.
    return { name: name.trim(), embedding: l2normalize(embedding as number[]) };
  });
}
