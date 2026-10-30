import { describe, expect, it, vi } from "vitest";
import { hedge } from "../src/gemma/hedge.js";

const options = { attempts: 3, staggerMs: 10, isFatal: () => false };

describe("hedge", () => {
  it("returns the first answer and aborts the others", async () => {
    let stalled: AbortSignal | undefined;
    let calls = 0;
    const result = await hedge((signal) => {
      calls += 1;
      if (calls === 1) {
        stalled = signal;
        return new Promise<string>(() => {});
      }
      return Promise.resolve("answer");
    }, options);
    expect(result).toBe("answer");
    expect(stalled?.aborted).toBe(true);
  });

  it("starts the next attempt as soon as one fails", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("500")).mockResolvedValue("answer");
    await expect(hedge(run, { ...options, staggerMs: 60_000 })).resolves.toBe("answer");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rejects after every attempt failed", async () => {
    const run = vi.fn().mockRejectedValue(new Error("500"));
    await expect(hedge(run, options)).rejects.toThrow("500");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("stops at once on a fatal error", async () => {
    const run = vi.fn().mockRejectedValue(new Error("400"));
    await expect(hedge(run, { ...options, staggerMs: 60_000, isFatal: () => true })).rejects.toThrow("400");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
