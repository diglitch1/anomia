import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, RotateCcw, X, CameraOff } from "lucide-react";
import { AppShell, BigButton, Loading } from "@/components/ui-kit";
import { speak } from "@/lib/api";
import { captureFrame, isPermissionError } from "@/lib/media";
import { voiceIdOrDefault } from "@/lib/storage";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Anomia — Demo" },
      { name: "description", content: "Scripted demo of the Speak screen." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DemoScreen,
});

const SENTENCES = ["I want to eat Pringles.", "I'm hungry.", "Can I have some food?"];
const THINKING_MS = 2000;

type Phase =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "thinking" }
  | { kind: "choose" }
  | { kind: "speaking"; text: string }
  | { kind: "spoken"; text: string };

// Scripted version of the Speak screen in index.tsx. Recording is only an animation: the
// microphone is never opened, and the photo stays in memory until the sentences appear.
function DemoScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camStream = useRef<MediaStream | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const photoUrl = useRef<string | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped whenever the flow moves on, so late async results are dropped.
  const run = useRef(0);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [camera, setCamera] = useState<"pending" | "on" | "denied" | "none">("pending");
  const [photo, setPhoto] = useState<string | null>(null);

  function showPhoto(url: string | null) {
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = url;
    setPhoto(url);
  }

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
      run.current++;
      clearTimeout(timer.current);
      camStream.current?.getTracks().forEach((t) => t.stop());
      audioEl.current?.pause();
      window.speechSynthesis?.cancel();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    };
  }, []);

  function findWords() {
    const current = ++run.current;
    // Async wrapper so a capture failure of any kind just means no photo.
    const frame = (async () => captureFrame(videoRef.current))().catch(() => null);
    setPhase({ kind: "thinking" });
    void frame.then((blob) => {
      if (blob && current === run.current) showPhoto(URL.createObjectURL(blob));
    });
    timer.current = setTimeout(() => {
      run.current++;
      showPhoto(null);
      setPhase({ kind: "choose" });
    }, THINKING_MS);
  }

  function speakWithBrowser(text: string) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    utterance.current = new SpeechSynthesisUtterance(text);
    utterance.current.lang = "en-US";
    synth.speak(utterance.current);
  }

  async function sayIt(text: string) {
    const current = ++run.current;
    setPhase({ kind: "speaking", text });
    try {
      const blob = await speak(text, voiceIdOrDefault());
      if (current !== run.current) return;
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      audioEl.current = new Audio(audioUrl.current);
      setPhase({ kind: "spoken", text });
      await audioEl.current.play();
    } catch {
      if (current !== run.current) return;
      audioEl.current = null;
      setPhase({ kind: "spoken", text });
      speakWithBrowser(text);
    }
  }

  function replay(text: string) {
    if (!audioEl.current) return speakWithBrowser(text);
    audioEl.current.currentTime = 0;
    audioEl.current.play().catch(() => speakWithBrowser(text));
  }

  const reset = () => {
    run.current++;
    audioEl.current?.pause();
    window.speechSynthesis?.cancel();
    setPhase({ kind: "idle" });
  };

  const recording = phase.kind === "recording";
  const showCamera = phase.kind === "idle" || recording || phase.kind === "thinking";

  return (
    <AppShell>
    <div className="flex flex-1 flex-col gap-5">
      <h1 className="sr-only">Speak (demo)</h1>

      <p className="-mb-3 self-end rounded-full bg-secondary px-3 py-0.5 text-base font-bold text-secondary-foreground">Demo</p>

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
        {photo && <img src={photo} alt="Photo just taken" className="absolute inset-0 size-full object-cover" />}
        {recording && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-recording px-4 py-2 text-lg font-bold text-recording-foreground">
            <span className="size-3 rounded-full bg-recording-foreground" aria-hidden /> Recording
          </div>
        )}
      </section>

      <div aria-live="polite" className="flex flex-1 flex-col justify-end gap-4">
        {(phase.kind === "idle" || recording) && (
          <div className="flex flex-col items-center gap-3 pb-2">
            <button
              type="button"
              onClick={recording ? findWords : () => setPhase({ kind: "recording" })}
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
            {SENTENCES.map((s) => (
              <BigButton key={s} variant="secondary" className="justify-start text-left text-2xl" onClick={() => void sayIt(s)}>
                <Volume2 className="size-8 shrink-0 text-primary" aria-hidden />
                <span>{s}</span>
              </BigButton>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <BigButton variant="ghost" onClick={reset}>
                <X className="size-7" aria-hidden /> None
              </BigButton>
              <BigButton variant="ghost" onClick={findWords}>
                <RotateCcw className="size-7" aria-hidden /> Try again
              </BigButton>
            </div>
          </>
        )}

        {phase.kind === "spoken" && (
          <>
            <p className="rounded-2xl bg-card p-5 text-3xl font-bold shadow-soft">“{phase.text}”</p>
            <BigButton variant="accent" className="py-6 text-2xl" onClick={() => replay(phase.text)}>
              <Volume2 className="size-9" aria-hidden /> Say it again
            </BigButton>
            <BigButton onClick={reset}>
              <Mic className="size-7" aria-hidden /> New
            </BigButton>
          </>
        )}
      </div>
    </div>
    </AppShell>
  );
}
