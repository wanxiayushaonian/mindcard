import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#94B4C8",
          dark: "#5A6A7A",
          light: "#B8D4E3",
        },
        bg: "#F9FAFC",
        surface: "#FFFFFF",
        text: {
          DEFAULT: "#2C3E50",
          secondary: "#8E99A4",
        },
        danger: "#E25D5D",
      },
      borderRadius: {
        card: "20px",
      },
      typography: {
        DEFAULT: {
          css: {
            color: "#2C3E50",
            maxWidth: "none",
            h1: { color: "#2C3E50" },
            h2: { color: "#2C3E50" },
            h3: { color: "#2C3E50" },
            h4: { color: "#2C3E50" },
            strong: { color: "#2C3E50" },
            code: { color: "#5A6A7A" },
            "code::before": { content: '""' },
            "code::after": { content: '""' },
            blockquote: { color: "#8E99A4", borderLeftColor: "#94B4C8" },
            hr: { borderColor: "#E5E7EB" },
            thead: { color: "#2C3E50", borderBottomColor: "#E5E7EB" },
            "tbody tr": { borderBottomColor: "#F3F4F6" },
          },
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
