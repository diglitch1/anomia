import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../src/http.js";
import { createVoiceRouter, transcribe } from "../src/voice/index.js";
import { LruCache } from "../src/voice/lru.js";

const sdk = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn(), convert: vi.fn() }));

vi.mock("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: class {
    textToSpeech = { stream: sdk.stream };
    voices = { ivc: { create: sdk.create } };
    speechToText = { convert: sdk.convert };
  },
}));

const VOICE = "abcDEF1234567890";

async function* chunks(...parts: string[]) {
  for (const part of parts) yield Buffer.from(part);
}

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api", createVoiceRouter());
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => server.close());

beforeEach(() => {
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("DEFAULT_VOICE_ID", "defaultvoice123");
  sdk.stream.mockReset().mockImplementation(async () => chunks("mp", "3"));
  sdk.create.mockReset().mockResolvedValue({ voiceId: "cloned123456" });
  sdk.convert.mockReset().mockResolvedValue({ text: " wa cup " });
});

let unique = 0;
const speak = (body: unknown) =>
  fetch(`${base}/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const freshText = () => `sentence ${++unique}`;

function cloneForm(consent: string, type = "audio/mpeg") {
  const form = new FormData();
  form.set("name", "Sam");
  form.set("consent", consent);
  form.append("samples", new Blob(["x"], { type }), "sample");
  return form;
}
const clone = (form: FormData) => fetch(`${base}/voice/clone`, { method: "POST", body: form });

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new LruCache<number>(2, 1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(2);
  });

  it("expires entries after the ttl", () => {
    let now = 0;
    const cache = new LruCache<number>(2, 1000, () => now);
    cache.set("a", 1);
    now = 2000;
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("POST /speak", () => {
  it("maps default to DEFAULT_VOICE_ID and streams mp3", async () => {
    const res = await speak({ text: ` ${freshText()} `, voiceId: "default" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/mpeg");
    expect(await res.text()).toBe("mp3");
    expect(sdk.stream.mock.calls[0]?.[0]).toBe("defaultvoice123");
    expect(sdk.stream.mock.calls[0]?.[1]).toMatchObject({ modelId: "eleven_flash_v2_5", outputFormat: "mp3_44100_128" });
  });

  it.each([
    [{ text: "   ", voiceId: VOICE }],
    [{ text: "x".repeat(301), voiceId: VOICE }],
    [{ voiceId: VOICE }],
    [{ text: "Hi", voiceId: "../etc" }],
    [{ text: "Hi" }],
  ])("rejects %j", async (body) => {
    const res = await speak(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
    expect(sdk.stream).not.toHaveBeenCalled();
  });

  it("accepts exactly 300 characters", async () => {
    expect((await speak({ text: "y".repeat(300), voiceId: VOICE })).status).toBe(200);
  });

  it("serves repeats from the cache", async () => {
    const text = freshText();
    await (await speak({ text, voiceId: VOICE })).text();
    const res = await speak({ text, voiceId: VOICE });
    expect(await res.text()).toBe("mp3");
    expect(sdk.stream).toHaveBeenCalledTimes(1);
  });

  it("does not cache a stream that fails partway", async () => {
    sdk.stream.mockImplementation(async () =>
      (async function* () {
        yield Buffer.from("partial");
        throw new Error("boom");
      })(),
    );
    const text = freshText();
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 2; i++) await speak({ text, voiceId: VOICE }).then((r) => r.text()).catch(() => {});
    expect(sdk.stream).toHaveBeenCalledTimes(2);
  });

  it("explains missing keys and never logs the text", async () => {
    vi.stubEnv("DEFAULT_VOICE_ID", "");
    expect((await speak({ text: "Hi", voiceId: "default" })).status).toBe(503);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.stream.mockRejectedValue(Object.assign(new Error("secret sentence"), { statusCode: 401 }));
    const res = await speak({ text: "secret sentence", voiceId: VOICE });
    expect(res.status).toBe(502);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});

describe("POST /voice/clone", () => {
  it.each(["", "false", "TRUE", "yes"])("refuses consent %j before any provider call", async (consent) => {
    expect((await clone(cloneForm(consent))).status).toBe(400);
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it("clones with consent", async () => {
    const res = await clone(cloneForm("true"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voiceId: "cloned123456" });
    expect(sdk.create.mock.calls[0]?.[0]).toMatchObject({ name: "Anomia - Sam", description: "created with consent via Anomia" });
  });

  it("rejects missing files and other types", async () => {
    const form = new FormData();
    form.set("name", "Sam");
    form.set("consent", "true");
    expect((await clone(form)).status).toBe(400);
    expect((await clone(cloneForm("true", "text/plain"))).status).toBe(400);
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it("returns JSON for an unreadable video", async () => {
    const res = await clone(cloneForm("true", "video/mp4"));
    expect(res.status).toBe(400);
    expect(sdk.create).not.toHaveBeenCalled();
  });
});

describe("transcribe", () => {
  it("returns the trimmed text", async () => {
    expect(await transcribe(Buffer.from("x"), "audio/webm")).toBe("wa cup");
  });

  it("handles multichannel responses", async () => {
    sdk.convert.mockResolvedValue({ transcripts: [{ text: "a" }, { text: "b" }] });
    expect(await transcribe(Buffer.from("x"), "audio/webm")).toBe("a b");
  });

  it("returns an empty string for silence and throws on provider errors", async () => {
    sdk.convert.mockResolvedValue({ text: "" });
    expect(await transcribe(Buffer.from("x"), "audio/webm")).toBe("");
    sdk.convert.mockRejectedValue(new Error("down"));
    await expect(transcribe(Buffer.from("x"), "audio/webm")).rejects.toThrow("down");
  });
});
