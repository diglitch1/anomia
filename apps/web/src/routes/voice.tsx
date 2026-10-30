import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload, Trash2, Check, Undo2, Volume2 } from "lucide-react";
import { AppShell, BigButton, ErrorBox, Loading, inputClass } from "@/components/ui-kit";
import { ApiError, audioExtension, cloneVoice, speak } from "@/lib/api";
import { isPermissionError, pickAudioMime } from "@/lib/media";
import { getVoiceId, setVoiceId } from "@/lib/storage";

export const Route = createFileRoute("/voice")({
  head: () => ({
    meta: [
      { title: "My voice | Anomia" },
      { name: "description", content: "Use your own voice for the sentences you choose." },
      { property: "og:title", content: "My voice | Anomia" },
      { property: "og:description", content: "Use your own voice for the sentences you choose." },
    ],
  }),
  component: VoiceScreen,
});

const MAX_FILES = 5;
const MAX_BYTES = 30 * 1024 * 1024;
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

function VoiceScreen() {
  return (
    <AppShell>
      <VoicePanel />
    </AppShell>
  );
}

function VoicePanel() {
  const [voiceId, setVoice] = useState<string | null>(null);
  const [samples, setSamples] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [testing, setTesting] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setVoice(getVoiceId()), []);
  useEffect(() => () => recRef.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const total = samples.reduce((n, f) => n + f.size, 0);
  const tooBig = total > MAX_BYTES;
  const canAdd = samples.length < MAX_FILES;
  const canSubmit = samples.length >= 1 && samples.length <= MAX_FILES && !tooBig && name.trim() && consent;

  function addFiles(files: File[]) {
    setSamples((s) => [...s, ...files].slice(0, MAX_FILES));
  }

  async function toggleRecord() {
    if (recording) return recRef.current?.stop();
    setMicDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || mime || "audio/webm";
        addFiles([new File(chunks, `sample-${Date.now()}.${audioExtension(type)}`, { type })]);
        setRecording(false);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      if (isPermissionError(e)) setMicDenied(true);
      else setError("Recording needs a secure (HTTPS) connection.");
    }
  }

  async function testVoice() {
    setError(null);
    setTesting(true);
    try {
      const blob = await speak("Hello, this is my voice.", voiceId ?? "default");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not play the voice.");
    } finally {
      setTesting(false);
    }
  }

  async function submit() {
    setError(null);
    setStatus("sending");
    try {
      const id = await cloneVoice(samples, name.trim());
      setVoiceId(id);
      setVoice(id);
      setSamples([]);
      setConsent(false);
      setStatus("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setStatus("idle");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <h1 className="text-3xl font-bold">My voice</h1>

      <div className="flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-soft">
        <p className="text-xl font-bold">{voiceId ? "Using: your voice" : "Using: standard voice"}</p>
        <BigButton variant="secondary" disabled={testing} onClick={() => void testVoice()}>
          <Volume2 className="size-7" aria-hidden /> {testing ? "Playing..." : "Hear this voice"}
        </BigButton>
        {voiceId && (
          <BigButton variant="ghost" onClick={() => { setVoiceId(null); setVoice(null); setStatus("idle"); }}>
            <Undo2 className="size-7" aria-hidden /> Use standard voice
          </BigButton>
        )}
      </div>

      {status === "sending" ? (
        <Loading label="Making your voice…" />
      ) : (
        <>
          {status === "done" && (
            <p role="status" className="flex items-center gap-2 text-2xl font-bold text-accent">
              <Check className="size-8" aria-hidden /> Your voice is ready
            </p>
          )}
          <p className="text-lg">Add 1 to 5 clips of you talking. A clear minute or more works best.</p>

          <div className="grid grid-cols-2 gap-3">
            <BigButton
              variant={recording ? "primary" : "secondary"}
              className={recording ? "animate-rec bg-recording text-recording-foreground" : ""}
              onClick={() => void toggleRecord()}
              disabled={!recording && !canAdd}
              aria-pressed={recording}
            >
              {recording ? <Square className="size-7" fill="currentColor" aria-hidden /> : <Mic className="size-7" aria-hidden />}
              {recording ? "Stop" : "Record"}
            </BigButton>
            <BigButton variant="secondary" onClick={() => fileRef.current?.click()} disabled={!canAdd || recording}>
              <Upload className="size-7" aria-hidden /> Upload
            </BigButton>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*"
            multiple
            className="sr-only"
            aria-label="Upload voice samples"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          {micDenied && (
            <p role="alert" className="text-lg font-bold text-destructive">
              Microphone is blocked. Allow it in your browser settings.
            </p>
          )}

          {samples.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Samples">
              {samples.map((f, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-soft">
                  <span className="flex-1 truncate text-lg">Clip {i + 1}, {mb(f.size)} MB</span>
                  <button
                    type="button"
                    aria-label={`Remove clip ${i + 1}`}
                    className="tap flex items-center justify-center rounded-xl border-2"
                    onClick={() => setSamples((s) => s.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-7" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className={tooBig ? "text-lg font-bold text-destructive" : "text-base text-muted-foreground"}>
            {samples.length} of {MAX_FILES} clips, {mb(total)} of 30 MB
          </p>

          <div className="flex flex-col gap-2">
            <label htmlFor="voice-name" className="text-xl font-bold">Voice name</label>
            <input id="voice-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="My voice" />
          </div>

          <label className="flex cursor-pointer items-start gap-4 rounded-2xl bg-card p-4 shadow-soft">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 size-8 shrink-0 accent-primary"
            />
            <span className="text-lg font-bold">This is my voice, or I am legally allowed to decide for this person, and I agree to it being cloned by ElevenLabs.</span>
          </label>

          {error && <ErrorBox message={error} onRetry={() => setError(null)} retryLabel="OK" />}

          <BigButton onClick={() => void submit()} disabled={!canSubmit}>
            <Check className="size-7" aria-hidden /> Use my voice
          </BigButton>
        </>
      )}
    </div>
  );
}
