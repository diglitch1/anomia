import { describe, it, expect, beforeEach } from "vitest";
import { addPick, voiceIdOrDefault, setVoiceId } from "@/lib/storage";
import { friendlyMessage } from "@/lib/api";

describe("rules", () => {
  beforeEach(() => localStorage.clear());
  it("keeps only the last 10 picks", () => {
    let list: string[] = [];
    for (let i = 1; i <= 12; i++) list = addPick(list, `s${i}`);
    expect(list).toHaveLength(10);
    expect(list[0]).toBe("s3");
    expect(list[9]).toBe("s12");
  });
  it("uses 'default' voice when none stored", () => {
    expect(voiceIdOrDefault()).toBe("default");
    setVoiceId("abc");
    expect(voiceIdOrDefault()).toBe("abc");
  });
  it("429 asks to wait", () => {
    expect(friendlyMessage(429)).toMatch(/wait a moment/i);
  });
});
