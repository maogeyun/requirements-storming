"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FREE_MATCH_LABEL } from "../lib/lobby-copy";
import {
  ENTRY_GUIDE,
  REPLAY_LABEL,
  STEP1_LINE,
  STEP1_PRIMARY,
  STEP1_SKIP,
  STEP2_PRIMARY,
  STEP2_SKIP,
  armPreferAiHint,
  beginOnboardingReplay,
  isOnboardingDone,
  isOnboardingReplay,
  skipOnboarding,
} from "../lib/onboarding";

const ENTRIES = [
  {
    href: "/play?mode=vs_bot",
    title: "本地人机",
    blurb: "本座对局 · 其余座位自动",
    guide: ENTRY_GUIDE.local,
    kind: "local",
  },
  {
    href: "/lobby?mode=create",
    title: "联机 · 建房",
    blurb: "生成房间码 · 满 4 开局",
    guide: ENTRY_GUIDE.create,
    kind: "create",
  },
  {
    href: "/lobby?mode=join",
    title: "联机 · 加入",
    blurb: "输入房间码入座",
    guide: ENTRY_GUIDE.join,
    kind: "join",
  },
  {
    href: "/lobby?mode=match",
    title: FREE_MATCH_LABEL,
    blurb: "排队入桌 · 无需二次确认",
    guide: ENTRY_GUIDE.match,
    kind: "match",
  },
] as const;

type GuideStep = 0 | 1 | 2;

export function HomeLobby() {
  const router = useRouter();
  const [step, setStep] = useState<GuideStep>(0);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const finished = isOnboardingDone();
    setDone(finished);
    if (isOnboardingReplay() || !finished) setStep(1);
    else setStep(0);
    setReady(true);
  }, []);

  function skip() {
    skipOnboarding();
    setDone(true);
    setStep(0);
  }

  function primary() {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      router.push("/play?mode=vs_bot");
    }
  }

  function replay() {
    beginOnboardingReplay();
    setStep(1);
  }

  return (
    <main className={`shell open-shell${step === 1 ? " guide-step-1" : ""}`}>
      <header className="hero open-hero">
        <p className="eyebrow">Requirement Storm</p>
        <h1>需求风暴</h1>
        <p className="lede">Web 联机职场卡牌 · 规则 v1.2</p>
      </header>

      {step > 0 ? (
        <section className="guide-card" aria-label="新手引导">
          <p className="guide-step">第 {step} / 3 步</p>
          {step === 1 ? <p className="guide-line">{STEP1_LINE}</p> : null}
          <div className="guide-actions">
            <button type="button" className="primary" onClick={primary}>
              {step === 1 ? STEP1_PRIMARY : STEP2_PRIMARY}
            </button>
            <button type="button" className="ghost" onClick={skip}>
              {step === 1 ? STEP1_SKIP : STEP2_SKIP}
            </button>
          </div>
        </section>
      ) : null}

      <nav className="open-entries" aria-label="开局入口">
        {ENTRIES.map((entry) => (
          <Link
            key={entry.href}
            className={`open-entry${step === 2 ? " is-guide" : ""}${
              step === 2 && entry.kind === "local" ? " is-recommended" : ""
            }`}
            href={entry.href}
            onClick={(event) => {
              if (step === 0) return;
              if (entry.kind === "local") {
                event.preventDefault();
                if (step === 1) setStep(2);
                else router.push("/play?mode=vs_bot");
                return;
              }
              armPreferAiHint();
            }}
          >
            <span className="open-entry-title">{entry.title}</span>
            <span className="open-entry-blurb">
              {step === 2 ? entry.guide : entry.blurb}
            </span>
          </Link>
        ))}
      </nav>

      <p className="open-rules muted">
        <Link href="/rules">规则手册（占位）</Link>
        {ready && done && step === 0 ? (
          <button type="button" className="ghost guide-replay" onClick={replay}>
            {REPLAY_LABEL}
          </button>
        ) : null}
      </p>
    </main>
  );
}
