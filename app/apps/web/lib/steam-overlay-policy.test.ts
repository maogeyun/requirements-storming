import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STEAM_OVERLAY_CHROME,
  soloPlayRequiresSteam,
  steamOverlayBlocksPlay,
} from "./steam-overlay-policy";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app/globals.css"),
  "utf8",
);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("steam overlay chrome", () => {
  it("does not block click-to-play cards or forced windows", () => {
    expect(steamOverlayBlocksPlay()).toBe(false);
    expect(STEAM_OVERLAY_CHROME.mustNotCover).toEqual([".hand-card", ".forced-window"]);
    expect(soloPlayRequiresSteam()).toBe(false);
  });

  it("keeps the chrome in normal flow with clicks passing through", () => {
    const body = ruleBody(".steam-shell-chrome");
    expect(body).toMatch(/position:\s*static/);
    expect(body).toMatch(/pointer-events:\s*none/);
    expect(body).not.toMatch(/position:\s*fixed/);
    expect(body).not.toMatch(/hand-card|forced-window/);
  });

  it("leaves card and forced-window hit targets alone", () => {
    const chromeRules = css.match(/\.steam-shell-chrome[^{]*\{[^}]*\}/g)?.join("\n") ?? "";
    expect(chromeRules).not.toMatch(/hand-card|forced-window/);
    expect(chromeRules.length).toBeGreaterThan(0);
  });
});
