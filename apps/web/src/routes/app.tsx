import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Mic, MicOff, RotateCcw, Square, Volume2, X } from "lucide-react";
import { AppShell, BigButton, ErrorBox, Loading, SoundBars } from "@/components/ui-kit";
import { ApiError, speak, suggest } from "@/lib/api";
import { captureFrame, isPermissionError, pickAudioMime } from "@/lib/media";
import { getCameraOn, getProfile, getRecentPicks, rememberPick, setCameraOn, voiceIdOrDefault } from "@/lib/storage";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Speak | Anomia" },
      { name: "description", content: "Record, pick a sentence, and say it in your own voice." },
      { property: "og:title", content: "Speak | Anomia" },
      { property: "og:description", content: "Record, pick a sentence, and say it in your own voice." },
    ],
  }),
  component: SpeakScreen,
});

const MAX_RECORDING_SECONDS = 30;
const MIN_AUDIO_BYTES = 1000;
const QUICK_PHRASES = ["Yes", "No", "I need help", "I am in pain", "Toilet, please", "Thank you"];

type Phase =
  | { kind: "idle"; note?: string }
  | { kind: "recording" }
  | { kind: "thinking" }
  | { kind: "choose"; suggestions: string[]; heard: string; scene: string | null }
  | { kind: "speaking" }
  | { kind: "spoken"; text: string; note?: string }
  | { kind: "error"; message: string; retry: () => void };

type CameraState = "off" | "pending" | "on" | "denied" | "none";

function SpeakScreen() {
  return (
    <AppShell>
      <Speak />
    </AppShell>
  );
}

function Speak() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camStream = useRef<MediaStream | null>(null);
  const cameraOn = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const lastSubmit = useRef<{ audio: Blob; image: Blob | null } | null>(null);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [camera, setCamera] = useState<CameraState>("off");
  const [micDenied, setMicDenied] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return setCamera("none");
    setCamera("pending");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      camStream.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      cameraOn.current = true;
      setCamera("on");
      setCameraOn(true);
    } catch (e) {
      setCamera(isPermissionError(e) ? "denied" : "none");
    }
  }

  function stopCamera() {
    camStream.current?.getTracks().forEach((t) => t.stop());
    camStream.current = null;
    cameraOn.current = false;
    setCamera("off");
    setCameraOn(false);
  }

  useEffect(() => {
    if (getCameraOn()) void startCamera();
    return () => {
      camStream.current?.getTracks().forEach((t) => t.stop());
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      if (stopTimer.current) clearTimeout(stopTimer.current);
      audioEl.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, []);

  useEffect(() => {
    if (phase.kind !== "recording") return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase.kind]);

  async function send(audio: Blob, image: Blob | null) {
    lastSubmit.current = { audio, image };
    setPhase({ kind: "thinking" });
    try {
      const res = await suggest({ audio, image, profile: getProfile(), recentPicks: getRecentPicks() });
      const scene = res.sceneTag && res.sceneTag !== "unknown" ? res.sceneTag : null;
      setPhase({ kind: "choose", suggestions: res.suggestions.slice(0, 3), heard: res.transcriptGuess, scene });
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
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setPhase({ kind: "idle", note: "Recording needs a secure (HTTPS) connection. You can still use the phrases below." });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickAudioMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (ev) => ev.data.size && chunks.current.push(ev.data);
      rec.onstop = async () => {
        if (stopTimer.current) clearTimeout(stopTimer.current);
        stream.getTracks().forEach((t) => t.stop());
        const audio = new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" });
        if (audio.size < MIN_AUDIO_BYTES) {
          setPhase({ kind: "idle", note: "That was too short. Tap, speak, then tap again." });
          return;
        }
        const image = cameraOn.current ? await captureFrame(videoRef.current) : null;
        void send(audio, image);
      };
      recorder.current = rec;
      rec.start();
      stopTimer.current = setTimeout(stopRecording, MAX_RECORDING_SECONDS * 1000);
      setPhase({ kind: "recording" });
    } catch (e) {
      if (isPermissionError(e)) setMicDenied(true);
      else setPhase({ kind: "error", message: "Recording is not available.", retry: () => setPhase({ kind: "idle" }) });
    }
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function speakWithDevice(text: string): boolean {
    if (!window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setPlaying(true);
    utterance.onend = () => setPlaying(false);
    window.speechSynthesis.speak(utterance);
    return true;
  }

  // Nothing is spoken until the person taps a sentence: that tap is the confirmation.
  async function sayIt(text: string, remember = true) {
    setPhase({ kind: "speaking" });
    audioEl.current?.pause();
    audioEl.current = null;
    try {
      const blob = await speak(text, voiceIdOrDefault());
      if (remember) rememberPick(text);
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl.current);
      audio.onplay = () => setPlaying(true);
      audio.onended = () => setPlaying(false);
      audio.onpause = () => setPlaying(false);
      audioEl.current = audio;
      setPhase({ kind: "spoken", text });
      await audio.play().catch(() => {
        setPhase({ kind: "spoken", text, note: "Tap Say it again to hear it." });
      });
    } catch (e) {
      if (speakWithDevice(text)) {
        if (remember) rememberPick(text);
        setPhase({ kind: "spoken", text, note: "Your voice is not available right now, so this device spoke instead." });
        return;
      }
      setPhase({
        kind: "error",
        message: e instanceof ApiError ? e.message : "Could not play the sentence.",
        retry: () => void sayIt(text, remember),
      });
    }
  }

  function replay(text: string) {
    if (!audioEl.current) return void speakWithDevice(text);
    audioEl.current.currentTime = 0;
    void audioEl.current.play();
  }

  const reset = (note?: string) => {
    audioEl.current?.pause();
    window.speechSynthesis?.cancel();
    setPhase(note ? { kind: "idle", note } : { kind: "idle" });
  };

  const recording = phase.kind === "recording";
  const composing = phase.kind === "idle" || recording;
  const cameraVisible = composing && camera !== "off";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="sr-only">Speak</h1>

      <section
        aria-label="Camera"
        className={cameraVisible ? "relative h-[32dvh] w-full overflow-hidden rounded-2xl bg-muted shadow-soft" : "sr-only"}
      >
        <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" className="size-full object-cover" />
        {(camera === "denied" || camera === "none") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-lg font-bold">
              {camera === "denied" ? "The camera is blocked. Allow it in your browser settings." : "No camera found. You can still speak."}
            </p>
          </div>
        )}
      </section>

      {micDenied && (
        <div role="alert" className="flex gap-3 rounded-2xl bg-card p-4 shadow-soft">
          <MicOff className="size-8 shrink-0 text-destructive" aria-hidden />
          <p className="text-lg font-bold">Microphone is blocked. Allow the microphone in your browser settings, then tap again.</p>
        </div>
      )}

      <div aria-live="polite" className="flex flex-1 flex-col justify-center gap-4">
        {composing && (
          <div className="rise flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              aria-pressed={recording}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={
                recording
                  ? "animate-rec flex size-36 items-center justify-center rounded-full bg-recording text-recording-foreground shadow-soft transition-transform active:scale-95"
                  : "flex size-36 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft transition-transform active:scale-95"
              }
            >
              {recording ? <Square className="size-14" fill="currentColor" aria-hidden /> : <Mic className="size-16" aria-hidden />}
            </button>
            <p className="text-2xl font-bold">{recording ? `Listening, ${seconds} s. Tap to stop` : "Tap and talk"}</p>
            {!recording && <p className="text-center text-lg text-muted-foreground">Say any words you can. Broken words are fine.</p>}
            {phase.kind === "idle" && phase.note && (
              <p role="status" className="rounded-xl bg-card px-4 py-3 text-center text-lg font-bold shadow-soft">
                {phase.note}
              </p>
            )}
          </div>
        )}

        {phase.kind === "thinking" && <Loading label="Finding your words..." />}
        {phase.kind === "speaking" && <Loading label="Getting your voice ready..." />}

        {phase.kind === "choose" && (
          <div className="rise flex flex-col gap-3">
            {phase.heard && (
              <p className="text-lg text-muted-foreground">
                I heard: <span className="font-bold text-foreground">{phase.heard}</span>
              </p>
            )}
            {phase.scene && (
              <p className="text-lg text-muted-foreground">
                I see: <span className="font-bold text-foreground">{phase.scene}</span>
              </p>
            )}
            <h2 className="text-2xl font-bold">Did you mean</h2>
            {phase.suggestions.map((s) => (
              <BigButton key={s} variant="secondary" className="justify-start bg-card text-left text-2xl leading-snug" onClick={() => void sayIt(s)}>
                <Volume2 className="size-8 shrink-0 text-primary" aria-hidden />
                <span>{s}</span>
              </BigButton>
            ))}
            <p className="text-center text-base text-muted-foreground">Nothing is said until you tap a sentence.</p>
            <div className="grid grid-cols-2 gap-3">
              <BigButton variant="ghost" onClick={() => reset("Nothing was said. Try again whenever you are ready.")}>
                <X className="size-7" aria-hidden /> None of these
              </BigButton>
              <BigButton variant="ghost" onClick={() => (lastSubmit.current ? void send(lastSubmit.current.audio, lastSubmit.current.image) : reset())}>
                <RotateCcw className="size-7" aria-hidden /> Other ideas
              </BigButton>
            </div>
          </div>
        )}

        {phase.kind === "spoken" && (
          <div className="rise flex flex-col gap-4">
            <div className="flex flex-col gap-4 rounded-2xl bg-card p-6 shadow-soft">
              <SoundBars className="h-8 text-accent" active={playing} />
              <p className="font-display text-3xl font-semibold leading-tight">{phase.text}</p>
            </div>
            {phase.note && <p role="status" className="text-lg font-bold">{phase.note}</p>}
            <BigButton variant="accent" className="py-6 text-2xl" onClick={() => replay(phase.text)}>
              <Volume2 className="size-9" aria-hidden /> Say it again
            </BigButton>
            <BigButton onClick={() => reset()}>
              <Mic className="size-7" aria-hidden /> Say something new
            </BigButton>
          </div>
        )}

        {phase.kind === "error" && (
          <>
            <ErrorBox message={phase.message} onRetry={phase.retry} />
            <BigButton variant="ghost" onClick={() => reset()}>
              <X className="size-7" aria-hidden /> Start over
            </BigButton>
          </>
        )}
      </div>

      {phase.kind === "idle" && (
        <div className="flex flex-col gap-3">
          <BigButton variant="ghost" aria-pressed={camera === "on"} onClick={() => (camera === "off" ? void startCamera() : stopCamera())}>
            {camera === "off" ? <Camera className="size-7" aria-hidden /> : <CameraOff className="size-7" aria-hidden />}
            {camera === "off" ? "Show what I see" : "Turn camera off"}
          </BigButton>
          <section aria-label="Quick phrases" className="grid grid-cols-3 gap-2">
            {QUICK_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => void sayIt(phrase, false)}
                className="tap rounded-xl border-2 bg-card px-1 text-base font-bold leading-tight transition-transform active:scale-95"
              >
                {phrase}
              </button>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
