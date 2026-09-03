import type { Config } from "tailwindcss";

/**
 * BWM design tokens.
 *
 * The palette is fixed by CLAUDE.md — every colour below maps 1:1 to a token
 * documented there. No extra hues are invented: secondary text uses opacity
 * modifiers on `ink` (e.g. `text-ink/60`) rather than new greys.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /** Near-black — dark surfaces, headings, body text */
        ink: "#0C0C0A",
        /** Warm white — the main app canvas */
        paper: "#FAFAF7",
        /** Cream — secondary surfaces, table headers, inset panels */
        cream: "#F5F2EB",
        /** Hairline borders — used instead of heavy shadows */
        line: "#E2E0D8",
        brand: {
          DEFAULT: "#1A6B3A",
          tint: "#E8F5EE",
        },
        warn: {
          DEFAULT: "#C4730A",
          tint: "#FEF3DC",
        },
        danger: {
          DEFAULT: "#C0392B",
          tint: "#FDECEA",
        },
        info: {
          DEFAULT: "#1A4FA0",
          tint: "#E8EEFF",
        },
      },
      fontFamily: {
        display: ["var(--font-syne)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-dm-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        eyebrow: "0.18em",
      },
      borderRadius: {
        card: "14px",
        pill: "999px",
      },
      maxWidth: {
        shell: "1180px",
      },
      spacing: {
        sidebar: "240px",
      },
      backgroundImage: {
        /** Subtle radial green glow for dark hero/header areas */
        "glow-brand":
          "radial-gradient(60% 80% at 15% 0%, rgba(26,107,58,0.38) 0%, rgba(26,107,58,0.10) 42%, rgba(12,12,10,0) 72%)",
        "glow-brand-soft":
          "radial-gradient(70% 120% at 85% 110%, rgba(26,107,58,0.24) 0%, rgba(12,12,10,0) 65%)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        /* Transform-only: if the animation never runs, the element is still
           in its final position rather than invisible. */
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        // `forwards` matters: without a fill mode these animations leave the
        // element at its pre-animation opacity if the animation is suppressed
        // or interrupted, which silently renders panels invisible.
        "fade-in": "fade-in 160ms ease-out forwards",
        "scale-in": "scale-in 180ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "slide-in-right": "slide-in-right 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
