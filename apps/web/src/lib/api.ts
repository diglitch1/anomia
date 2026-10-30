const API = (import.meta.env['VITE_API_URL'] as string | undefined) ?? "";

export class ApiError extends Error {}

export type SuggestResponse = {
  transcriptGuess: string;
  suggestions: [string, string, string];
  sceneTag?: string;
};

export function friendlyMessage(status: number): string {
  if (status === 429) return "Please wait a moment, then try again.";
  if (status >= 500) return "Something went wrong. Please try again.";
  return "That didn't work. Please try again.";
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch {
    throw new ApiError("No connection. Please try again.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* ignore */
    }
    if (detail) console.warn(`API ${path} ${res.status}: ${detail}`);
    throw new ApiError(friendlyMessage(res.status));
  }
  return res;
}

export function audioExtension(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export async function suggest(args: {
  audio: Blob;
  image: Blob | null;
  profile: unknown;
  recentPicks: string[];
}): Promise<SuggestResponse> {
  const fd = new FormData();
  const type = args.audio.type || "audio/webm";
  fd.append("audio", new File([args.audio], `recording.${audioExtension(type)}`, { type }));
  if (args.image) fd.append("image", new File([args.image], "frame.jpg", { type: "image/jpeg" }));
  fd.append("profile", JSON.stringify(args.profile));
  fd.append("recentPicks", JSON.stringify(args.recentPicks));
  const res = await request("/api/suggest", { method: "POST", body: fd });
  return (await res.json()) as SuggestResponse;
}

export async function speak(text: string, voiceId: string): Promise<Blob> {
  const res = await request("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId }),
  });
  return await res.blob();
}

export async function cloneVoice(samples: File[], name: string): Promise<string> {
  const fd = new FormData();
  samples.forEach((s) => fd.append("samples", s, s.name));
  fd.append("name", name);
  fd.append("consent", "true");
  const res = await request("/api/voice/clone", { method: "POST", body: fd });
  return ((await res.json()) as { voiceId: string }).voiceId;
}
