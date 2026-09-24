import type { NextConfig } from "next";

/**
 * Desktop release only. Tauri cannot host the Next server, so
 * `pnpm --filter @rs/web build:desktop` statically exports `out/` and the
 * shell embeds that directory. `next dev` / `next build` / `next start` stay
 * the existing Node server for the web app.
 */
const desktopExport =
  process.env.RS_DESKTOP_EXPORT === "1" ||
  process.env.npm_lifecycle_event === "build:desktop";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@rs/shared", "@rs/game-data", "@rs/rules-engine"],
  ...(desktopExport
    ? {
        output: "export" as const,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
