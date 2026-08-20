/** 可复现的轻量 PRNG（Mulberry32） */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function drawOne<T>(items: T[], rng: () => number): { item: T; rest: T[] } {
  if (items.length === 0) {
    throw new Error("Cannot draw from empty collection");
  }
  const index = Math.floor(rng() * items.length);
  const item = items[index];
  const rest = items.filter((_, i) => i !== index);
  return { item, rest };
}
