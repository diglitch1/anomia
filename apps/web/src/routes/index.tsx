import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, RotateCcw, X, CameraOff, MicOff } from "lucide-react";
import { BigButton, ErrorBox, Loading } from "@/components/ui-kit";
import { ApiError, speak, suggest } from "@/lib/api";
import { captureFrame, isPermissionError, pickAudioMime } from "@/lib/media";
import { getProfile, getRecentPicks, rememberPick, voiceIdOrDefault } from "@/lib/storage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anomia — Speak" },
      { name: "description", content: "Record, pick a sentence, and say it in your own voice." },
      { property: "og:title", content: "Anomia — Speak" },
      { property: "og:description", content: "Record, pick a sentence, and say it in your own voice." },
    ],
  }),
  component: SpeakScreen,
});

type Phase =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "thinking" }
  | { kind: "choose"; suggestions: string[] }
  | { kind: "speaking"; text: string }
  | { kind: "spoken"; text: string }
  | { kind: "error"; message: string; retry: () => void };

function SpeakScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camStream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const lastSubmit = useRef<{ audio: Blob; image: Blob | null } | null>(null);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [camera, setCamera] = useState<"pending" | "on" | "denied" | "none">("pending");
  const [micDenied, setMicDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setCamera("none");
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        camStream.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setCamera("on");
      } catch (e) {
        setCamera(isPermissionError(e) ? "denied" : "none");
      }
    })();
    return () => {
      cancelled = true;
      camStream.current?.getTracks().forEach((t) => t.stop());
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      audioEl.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, []);

  async function send(audio: Blob, image: Blob | null) {
    lastSubmit.current = { audio, image };
    setPhase({ kind: "thinking" });
    try {
      const res = await suggest({ audio, image, profile: getProfile(), recentPicks: getRecentPicks() });
      setPhase({ kind: "choose", suggestions: res.suggestions.slice(0, 3) });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof ApiError ? e.message : "Something went wrong.",
        retry: () => void send(audio, image),
      });
    }
  }

  async function startRecording() {
    setMicDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (ev) => ev.data.size && chunks.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const audio = new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" });
        const image = camera === "on" ? await captureFrame(videoRef.current) : null;
        void send(audio, image);
      };
      recorder.current = rec;
      rec.start();
      setPhase({ kind: "recording" });
    } catch (e) {
      if (isPermissionError(e)) setMicDenied(true);
      else setPhase({ kind: "error", message: "Recording is not available.", retry: () => setPhase({ kind: "idle" }) });
    }
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function sayIt(text: string) {
    setPhase({ kind: "speaking", text });
    try {
      const blob = await speak(text, voiceIdOrDefault());
      rememberPick(text);
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      audioEl.current = new Audio(audioUrl.current);
      setPhase({ kind: "spoken", text });
      await audioEl.current.play().catch(() => undefined);
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof ApiError ? e.message : "Could not play the sentence.",
        retry: () => void sayIt(text),
      });
    }
  }

  function replay() {
    if (!audioEl.current) return;
    audioEl.current.currentTime = 0;
    void audioEl.current.play();
  }

  const reset = () => {
    audioEl.current?.pause();
    setPhase({ kind: "idle" });
  };

  const recording = phase.kind === "recording";
  const showCamera = phase.kind === "idle" || recording;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <h1 className="sr-only">Speak</h1>

      <section
        aria-label="Camera"
        className={showCamera ? "relative aspect-[3/4] max-h-[45dvh] w-full overflow-hidden rounded-2xl bg-muted shadow-soft" : "sr-only"}
      >
        <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" className="size-full object-cover" />
        {camera !== "on" && camera !== "pending" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff className="size-12 text-muted-foreground" aria-hidden />
            <p className="text-lg font-bold">
              {camera === "denied" ? "Camera is off. Allow camera in your browser settings to show what you see." : "No camera. You can still speak."}
            </p>
          </div>
        )}
        {recording && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-recording px-4 py-2 text-lg font-bold text-recording-foreground">
            <span className="size-3 rounded-full bg-recording-foreground" aria-hidden /> Recording
          </div>
        )}
      </section>

      {micDenied && (
        <div role="alert" className="flex gap-3 rounded-2xl bg-card p-4 shadow-soft">
          <MicOff className="size-8 shrink-0 text-destructive" aria-hidden />
          <p className="text-lg font-bold">Microphone is blocked. Allow the microphone in your browser settings, then tap again.</p>
        </div>
      )}

      <div aria-live="polite" className="flex flex-1 flex-col justify-end gap-4">
        {(phase.kind === "idle" || recording) && (
          <div className="flex flex-col items-center gap-3 pb-2">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              aria-pressed={recording}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={
                recording
                  ? "animate-rec flex size-40 items-center justify-center rounded-full bg-recording text-recording-foreground shadow-soft"
                  : "flex size-40 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft"
              }
            >
              {recording ? <Square className="size-16" fill="currentColor" aria-hidden /> : <Mic className="size-20" aria-hidden />}
            </button>
            <p className="text-2xl font-bold">{recording ? "Tap to stop" : "Tap and talk"}</p>
          </div>
        )}

        {phase.kind === "thinking" && <Loading label="Finding words…" />}
        {phase.kind === "speaking" && <Loading label="Getting ready…" />}

        {phase.kind === "choose" && (
          <>
            <h2 className="text-2xl font-bold">Did you mean…</h2>
            {phase.suggestions.map((s, i) => (
              <BigButton key={i} variant="secondary" className="justify-start text-left text-2xl" onClick={() => void sayIt(s)}>
                <Volume2 className="size-8 shrink-0 text-primary" aria-hidden />
                <span>{s}</span>
              </BigButton>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <BigButton variant="ghost" onClick={reset}>
                <X className="size-7" aria-hidden /> None
              </BigButton>
              <BigButton variant="ghost" onClick={() => lastSubmit.current ? void send(lastSubmit.current.audio, lastSubmit.current.image) : reset()}>
                <RotateCcw className="size-7" aria-hidden /> Try again
              </BigButton>
            </div>
          </>
        )}

        {phase.kind === "spoken" && (
          <>
            <p className="rounded-2xl bg-card p-5 text-3xl font-bold shadow-soft">“{phase.text}”</p>
            <BigButton variant="accent" className="py-6 text-2xl" onClick={replay}>
              <Volume2 className="size-9" aria-hidden /> Say it again
            </BigButton>
            <BigButton onClick={reset}>
              <Mic className="size-7" aria-hidden /> New
            </BigButton>
          </>
        )}

        {phase.kind === "error" && <ErrorBox message={phase.message} onRetry={phase.retry} />}
        {phase.kind === "error" && (
          <BigButton variant="ghost" onClick={reset}>
            <X className="size-7" aria-hidden /> Start over
          </BigButton>
        )}
      </div>
    </div>
  );
}
