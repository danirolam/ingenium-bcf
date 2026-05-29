import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Existing app variables (used by our custom CSS surfaces)
        bg: "var(--bg)",
        panel: "var(--panel)",
        ink: "var(--ink)",
        brand: "var(--accent)",

        // shadcn/ui token set (namespaced --sc-*, alpha-aware)
        border: "hsl(var(--sc-border) / <alpha-value>)",
        input: "hsl(var(--sc-input) / <alpha-value>)",
        ring: "hsl(var(--sc-ring) / <alpha-value>)",
        background: "hsl(var(--sc-background) / <alpha-value>)",
        foreground: "hsl(var(--sc-foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--sc-primary) / <alpha-value>)",
          foreground: "hsl(var(--sc-primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--sc-secondary) / <alpha-value>)",
          foreground: "hsl(var(--sc-secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--sc-destructive) / <alpha-value>)",
          foreground: "hsl(var(--sc-destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--sc-muted) / <alpha-value>)",
          foreground: "hsl(var(--sc-muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--sc-accent) / <alpha-value>)",
          foreground: "hsl(var(--sc-accent-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--sc-popover) / <alpha-value>)",
          foreground: "hsl(var(--sc-popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--sc-card) / <alpha-value>)",
          foreground: "hsl(var(--sc-card-foreground) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--sc-radius)",
        md: "calc(var(--sc-radius) - 2px)",
        sm: "calc(var(--sc-radius) - 4px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      fontFamily: {
        sans: [
          "Manrope",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica Neue",
          "sans-serif",
        ],
        geist: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        figtree: ["Figtree", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Georgia", "Times New Roman", "serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
