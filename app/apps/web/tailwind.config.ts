import type { Config } from "tailwindcss";
import { workplaceColors } from "./design-tokens/workplace-palette";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2563eb",
          dark: "#1d4ed8",
        },
        /* Locked workplace palette. No play surface uses these classes yet. */
        ws: workplaceColors,
      },
    },
  },
  plugins: [],
};

export default config;
