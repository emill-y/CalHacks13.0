"use client";

import { useEffect, useRef, useState } from "react";

interface SpeechRec {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type SpeechCtor = new () => SpeechRec;

/** Web Speech API dictation. Renders nothing where unsupported. */
export function VoiceButton({ onText }: { onText: (t: string) => void }) {
  const [Ctor, setCtor] = useState<SpeechCtor | null>(null);
  const [on, setOn] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    setCtor(() => w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null);
  }, []);
  if (!Ctor) return null;
  function toggle() {
    if (on) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor!();
    r.lang = navigator.language || "en-US";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => onText(e.results[0][0].transcript);
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    rec.current = r;
    setOn(true);
    r.start();
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={on ? "Stop dictation" : "Speak your edit"}
      className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border text-lg ${on ? "pulse-dot border-accent bg-accent text-accent-ink" : "border-line"}`}
    >
      🎙
    </button>
  );
}
