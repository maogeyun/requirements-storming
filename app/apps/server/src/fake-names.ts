/**
 * Fake human-looking display names for silent match Bot fill.
 * Never include "Bot" / "机器人" / "补位" — clients must not see machine labels.
 */

const FAKE_DISPLAY_NAMES = [
  "小林",
  "阿凯",
  "小满",
  "北辰",
  "阿泽",
  "清清",
  "老周",
  "米粒",
  "阿年",
  "晚晚",
  "阿诚",
  "小禾",
  "南风",
  "阿棠",
  "星河",
  "阿白",
  "小鹿",
  "阿澄",
  "听雨",
  "阿野",
  "小橘",
  "阿川",
  "云舒",
  "阿梨",
] as const;

const LEAK_RE = /(?:^|[^a-z])bot(?:[^a-z]|$)|机器人|补位|\bisBot\b|\bnpc\b/i;

export function assertHumanFacingName(name: string): void {
  if (LEAK_RE.test(name) || /^bot\s*\d*$/i.test(name.trim())) {
    throw new Error(`Fake display name leaks machine marker: ${name}`);
  }
}

/** Pick `count` distinct fake names, avoiding collisions with `taken`. */
export function pickFakeDisplayNames(
  count: number,
  taken: ReadonlySet<string> = new Set(),
  rng: () => number = Math.random,
): string[] {
  const pool = FAKE_DISPLAY_NAMES.filter((n) => !taken.has(n));
  const out: string[] = [];
  const available = [...pool];

  for (let i = 0; i < count; i += 1) {
    let name: string;
    if (available.length > 0) {
      const idx = Math.floor(rng() * available.length);
      name = available.splice(idx, 1)[0]!;
    } else {
      // Exhausted pool — still human-looking, never "Bot N"
      name = `玩家${Math.floor(rng() * 9000) + 1000}`;
      while (taken.has(name) || out.includes(name)) {
        name = `玩家${Math.floor(rng() * 9000) + 1000}`;
      }
    }
    assertHumanFacingName(name);
    out.push(name);
  }
  return out;
}

/** True if any client-facing string would expose Bot fill. */
export function leaksBotMarker(text: string): boolean {
  return LEAK_RE.test(text);
}
