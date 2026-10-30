import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  CircleSlash,
  Code2,
  Hand,
  ImageOff,
  Mic,
  MousePointerClick,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { SoundBars, Wordmark } from "@/components/ui-kit";

const REPO = "https://github.com/diglitch1/anomia";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anomia: say what you mean, in your own voice" },
      { name: "description", content: "Aphasia takes the words, not the thoughts. Anomia turns broken fragments into the sentence someone means, then says it in their own voice." },
      { property: "og:title", content: "Anomia: say what you mean, in your own voice" },
      { property: "og:description", content: "Aphasia takes the words, not the thoughts. Open source, built with Gemma 4 and ElevenLabs." },
    ],
  }),
  component: Landing,
});

const EXAMPLES = [
  {
    fragments: ["wa...", "cup...", "hot...", "no"],
    options: ["Can I have some water?", "The cup is too hot for me.", "I don't want a hot drink."],
    chosen: 1,
    audio: "/audio/example-cup.mp3",
  },
  {
    fragments: ["co...", "cold...", "win...", "shut"],
    options: ["I feel cold.", "Can you shut the window?", "Is it cold outside?"],
    chosen: 1,
    audio: "/audio/example-window.mp3",
  },
];

const STAGE_MS = [2300, 1100, 2100, 3000];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function HeroDemo() {
  const reduced = usePrefersReducedMotion();
  const [example, setExample] = useState(0);
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const holding = reduced || paused || playing;
  const shownStage = reduced ? 3 : stage;
  const current = EXAMPLES[example]!;

  useEffect(() => {
    if (holding) return;
    const timer = setTimeout(() => {
      if (stage === STAGE_MS.length - 1) {
        setStage(0);
        setExample((e) => (e + 1) % EXAMPLES.length);
      } else {
        setStage(stage + 1);
      }
    }, STAGE_MS[stage]);
    return () => clearTimeout(timer);
  }, [stage, holding]);

  useEffect(() => () => audio.current?.pause(), []);

  function hear() {
    audio.current?.pause();
    setStage(3);
    const element = new Audio(current.audio);
    element.onended = () => setPlaying(false);
    element.onerror = () => setPlaying(false);
    audio.current = element;
    setPlaying(true);
    element.play().catch(() => setPlaying(false));
  }

  return (
    <figure className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-secondary/70 blur-2xl" aria-hidden />
      <div className="rounded-[2.5rem] bg-ink p-3 shadow-soft">
        <div aria-hidden className="flex h-[29rem] flex-col rounded-[2rem] bg-background p-5">
          <p className="flex items-center justify-between text-sm font-bold text-muted-foreground">
            <span>Anomia</span>
            <SoundBars className="h-4 text-primary" active={shownStage === 0 || (shownStage === 3 && !holding) || playing} />
          </p>

          <div className="flex flex-1 flex-col justify-center gap-3">
            {shownStage < 2 && (
              <div key={example} className="flex flex-col items-center gap-5 text-center">
                <span className={shownStage === 0 ? "animate-rec flex size-20 items-center justify-center rounded-full bg-recording text-recording-foreground" : "flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground"}>
                  {shownStage === 0 ? <Mic className="size-9" /> : <Sparkles className="size-9" />}
                </span>
                <p className="flex min-h-20 flex-wrap justify-center gap-x-3 font-display text-3xl font-medium">
                  {current.fragments.map((word, i) => (
                    <span key={word} className="fragment rise" style={{ animationDelay: `${i * 420}ms` }}>
                      {word}
                    </span>
                  ))}
                </p>
                <p className="text-base font-bold text-muted-foreground">{shownStage === 0 ? "Listening" : "Finding the words"}</p>
              </div>
            )}

            {shownStage === 2 &&
              current.options.map((option, i) => (
                <p key={option} className="rise rounded-2xl border-2 bg-card p-4 text-lg font-bold leading-snug" style={{ animationDelay: `${i * 120}ms` }}>
                  {option}
                </p>
              ))}

            {shownStage === 3 && (
              <div className="rise flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-soft">
                <SoundBars className="h-8 text-accent" active={!reduced || playing} />
                <p className="font-display text-3xl font-semibold leading-tight">{current.options[current.chosen]}</p>
                <p className="flex items-center gap-2 text-base font-bold text-muted-foreground">
                  <MousePointerClick className="size-5" /> Confirmed with one tap
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      <figcaption className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={hear}
          className="tap inline-flex items-center gap-2 rounded-full bg-accent px-6 font-bold text-accent-foreground shadow-soft transition-transform active:scale-[0.97]"
        >
          <Play className="size-5" fill="currentColor" aria-hidden /> Hear this sentence
        </button>
        {!reduced && (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Resume the example" : "Pause the example"}
            className="tap inline-flex items-center justify-center rounded-full border-2"
          >
            {paused ? <Play className="size-5" aria-hidden /> : <Pause className="size-5" aria-hidden />}
          </button>
        )}
        <span className="w-full text-center text-sm text-muted-foreground">Scripted example with a synthetic voice.</span>
      </figcaption>
    </figure>
  );
}

const STEPS = [
  { icon: Mic, title: "Say what you can", text: "Broken words, sounds, a single syllable. Anything is a start." },
  { icon: Camera, title: "Show the scene", text: "If it helps, the camera adds what is in front of you. It is off until you turn it on." },
  { icon: Sparkles, title: "See three guesses", text: "Gemma 4 uses your words, the scene and your profile to offer three different meanings." },
  { icon: MousePointerClick, title: "Tap, and be heard", text: "Pick the right one, and ElevenLabs says it in your own voice." },
];

const PROMISES = [
  { icon: Hand, title: "It never speaks on its own", text: "Your tap is the confirmation. Until then, nothing leaves the speaker." },
  { icon: CircleSlash, title: "It stays silent when it's wrong", text: "\"None of these\" says nothing. A bad guess never puts words in your mouth." },
  { icon: UserRound, title: "Your voice needs your consent", text: "Cloning is refused without explicit consent, and only works from files you upload yourself." },
  { icon: ShieldCheck, title: "Your profile stays with you", text: "Names and routines are saved on your device. The server keeps no database and logs no sentences." },
  { icon: ImageOff, title: "Photos are cleaned first", text: "Metadata such as location is removed before a photo reaches the model." },
  { icon: Code2, title: "Open for anyone to build on", text: "MIT licensed, with an open-weight model you can also run on your own hardware." },
];

function Landing() {
  return (
    <div className="overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-lg focus:bg-card focus:p-3">
        Skip to content
      </a>

      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link to="/" aria-label="Anomia home" className="rounded-lg">
          <Wordmark />
        </Link>
        <nav aria-label="Page" className="flex items-center gap-5 font-bold">
          <a href="#how" className="hidden sm:inline">How it works</a>
          <a href="#promises" className="hidden sm:inline">Our promises</a>
          <a href={REPO} className="hidden sm:inline">GitHub</a>
          <Link to="/app" className="inline-flex min-h-12 items-center rounded-full bg-primary px-5 text-primary-foreground">
            Try it
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:pt-14">
          <div className="rise">
            <p className="mb-5 text-lg font-bold text-primary">For people living with aphasia</p>
            <h1 className="font-display text-5xl font-semibold leading-[1.03] tracking-tight sm:text-7xl">
              Aphasia takes the words. Not the thoughts.
            </h1>
            <p className="mt-6 max-w-xl text-xl leading-relaxed text-muted-foreground">
              Anomia turns the fragments someone can say into the sentence they mean, then says it out loud in their own voice.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/app" className="tap inline-flex items-center gap-2 rounded-full bg-primary px-7 text-xl font-bold text-primary-foreground shadow-soft transition-transform active:scale-[0.97]">
                Try Anomia <ArrowRight className="size-6" aria-hidden />
              </Link>
              <a href="#how" className="tap inline-flex items-center rounded-full border-2 px-7 text-xl font-bold">
                See how it works
              </a>
            </div>
          </div>
          <HeroDemo />
        </section>

        <section className="bg-ink text-ink-foreground">
          <div className="reveal mx-auto max-w-4xl px-4 py-24 text-center sm:px-6">
            <p className="font-display text-3xl italic opacity-75 sm:text-4xl">"wa... cup... hot... no"</p>
            <p className="mt-6 font-display text-5xl font-semibold leading-tight sm:text-6xl">
              You know exactly what you mean.
            </p>
            <p className="mx-auto mt-8 max-w-2xl text-xl leading-relaxed opacity-85">
              After a stroke, aphasia can take away speech, reading and writing while leaving intelligence untouched. Conversation does not wait while you search through a menu, so many people stop trying.
            </p>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-24 sm:px-6">
          <h2 className="reveal max-w-2xl font-display text-4xl font-semibold leading-tight sm:text-5xl">From fragments to your own voice in four steps</h2>
          <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="reveal rounded-2xl bg-card p-6 shadow-soft">
                <span className="flex items-center justify-between">
                  <Icon className="size-8 text-primary" aria-hidden />
                  <span className="font-display text-3xl text-muted-foreground" aria-hidden>{i + 1}</span>
                </span>
                <h3 className="mt-6 text-2xl font-bold leading-tight">{title}</h3>
                <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="promises" className="scroll-mt-6 bg-secondary/60">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <h2 className="reveal max-w-2xl font-display text-4xl font-semibold leading-tight sm:text-5xl">Built so it never speaks for you</h2>
            <ul className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {PROMISES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="reveal">
                  <Icon className="size-8 text-accent" aria-hidden />
                  <h3 className="mt-4 text-xl font-bold">{title}</h3>
                  <p className="mt-2 text-lg leading-relaxed text-muted-foreground">{text}</p>
                </li>
              ))}
            </ul>
            <p className="mt-12 max-w-3xl rounded-2xl bg-card p-6 text-lg leading-relaxed">
              <strong>Where your data goes:</strong> voice recordings and spoken sentences go to ElevenLabs. With the hosted model, fragments, your profile and photos go to Google. With a local Gemma model, only the speech steps leave your computer.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="reveal grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">Open source, from the model up</h2>
              <p className="mt-5 text-xl leading-relaxed text-muted-foreground">
                The hard part is understanding someone who cannot finish a sentence. We built that on open weights, so anyone can inspect it, improve it, or run it themselves.
              </p>
            </div>
            <dl className="divide-y-2 rounded-2xl bg-card px-6 shadow-soft">
              {[
                ["Gemma 4", "Turns fragments, scene and profile into three sentences"],
                ["ElevenLabs", "Speech-to-text, voice cloning and speech"],
                ["Lovable", "Built the accessible app you are using"],
              ].map(([name, role]) => (
                <div key={name} className="py-5">
                  <dt className="text-xl font-bold">{name}</dt>
                  <dd className="text-lg text-muted-foreground">{role}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="bg-primary text-primary-foreground">
          <div className="reveal mx-auto flex max-w-4xl flex-col items-center gap-8 px-4 py-24 text-center sm:px-6">
            <h2 className="font-display text-4xl font-semibold leading-tight sm:text-6xl">The thoughts were never gone.</h2>
            <div className="flex flex-wrap justify-center gap-3">
              <Link to="/app" className="tap inline-flex items-center gap-2 rounded-full bg-card px-7 text-xl font-bold text-foreground">
                Try Anomia <ArrowRight className="size-6" aria-hidden />
              </Link>
              <a href={REPO} className="tap inline-flex items-center rounded-full border-2 border-primary-foreground px-7 text-xl font-bold">
                View the code
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-base text-muted-foreground sm:px-6">
        <p>Hackathon prototype. A communication aid, not a medical device or therapy.</p>
        <p>MIT licensed. <a href={REPO} className="font-bold underline">GitHub</a></p>
      </footer>
    </div>
  );
}
