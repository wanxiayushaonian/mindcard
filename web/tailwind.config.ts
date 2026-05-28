import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          dark: "var(--color-primary-dark)",
          light: "#B8D4E3",
        },
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        text: {
          DEFAULT: "var(--color-text)",
          secondary: "var(--color-text-secondary)",
        },
        danger: "var(--color-danger)",
        border: "var(--color-border)",
        gray: {
          50: "var(--color-gray-50)",
          100: "var(--color-gray-100)",
          200: "var(--color-gray-200)",
          300: "var(--color-gray-300)",
          400: "var(--color-gray-400)",
        },
      },
      borderRadius: {
        card: "20px",
      },
      keyframes: {
        "slide-in": {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
      },
      animation: {
        "slide-in": "slide-in 0.3s ease-out",
      },
      typography: {
        DEFAULT: {
          css: {
            color: "var(--color-text)",
            maxWidth: "none",
            h1: { color: "var(--color-text)" },
            h2: { color: "var(--color-text)" },
            h3: { color: "var(--color-text)" },
            h4: { color: "var(--color-text)" },
            strong: { color: "var(--color-text)" },
            code: { color: "var(--color-primary-dark)" },
            "code::before": { content: '""' },
            "code::after": { content: '""' },
            blockquote: { color: "var(--color-text-secondary)", borderLeftColor: "var(--color-primary)" },
            hr: { borderColor: "var(--color-border)" },
            thead: { color: "var(--color-text)", borderBottomColor: "var(--color-border)" },
            "tbody tr": { borderBottomColor: "var(--color-gray-100)" },
          },
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography"), require("tailwindcss-animate")],
};

export default config;
