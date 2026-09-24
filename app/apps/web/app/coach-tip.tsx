"use client";

import { useEffect, useMemo, useState } from "react";
import {
  coachTipCopy,
  coachTriggerActive,
  isForcedCoachTip,
  isSoftCoachTip,
  markTipSeen,
  peekCoachPin,
  readTipsSeen,
  selectCoachTip,
  setCoachPin,
  type CoachContext,
  type CoachTipId,
} from "../lib/onboarding";

export function CoachTip({
  ctx,
  blocked = false,
}: {
  ctx: CoachContext;
  blocked?: boolean;
}) {
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [pinned, setPinned] = useState<CoachTipId | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loaded = new Set(readTipsSeen());
    setSeen(loaded);
    const pin = peekCoachPin();
    if (pin && loaded.has(pin)) setPinned(pin);
    setReady(true);
  }, []);

  const eligible = useMemo(
    () => (ready ? selectCoachTip(ctx, seen) : null),
    [ready, ctx, seen],
  );

  useEffect(() => {
    if (!ready) return;
    if (pinned) {
      if (!coachTriggerActive(pinned, ctx)) {
        setCoachPin(null);
        setPinned(null);
        return;
      }
      if (
        !blocked &&
        eligible &&
        eligible !== pinned &&
        isForcedCoachTip(eligible) &&
        isSoftCoachTip(pinned)
      ) {
        const next = new Set(seen);
        next.add(eligible);
        setSeen(next);
        markTipSeen(eligible);
        setCoachPin(eligible);
        setPinned(eligible);
      }
      return;
    }
    if (blocked || !eligible) return;
    const next = new Set(seen);
    next.add(eligible);
    setSeen(next);
    markTipSeen(eligible);
    setCoachPin(eligible);
    setPinned(eligible);
  }, [ready, pinned, eligible, blocked, ctx, seen]);

  if (!ready || !pinned || blocked) return null;
  if (!coachTriggerActive(pinned, ctx)) return null;

  const copy = coachTipCopy(pinned, ctx.disconnectGraceSec);
  return (
    <div className="info-tip tip-coach" role="status" aria-live="polite">
      <span className="coach-tip-title">{copy.title}</span>
      <span className="coach-tip-body">{copy.body}</span>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          setCoachPin(null);
          setPinned(null);
        }}
      >
        知道了
      </button>
    </div>
  );
}
