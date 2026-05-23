import type { Metadata } from "next";
import "./globals.css";
import { ToastContainer } from "@/lib/toast";

export const metadata: Metadata = {
  title: "MindCard - 灵感卡片",
  description: "Manage your inspiration cards with AI-powered search and RAG",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var t = localStorage.getItem('theme');
                var d = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (d) document.documentElement.classList.add('dark');
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-bg text-text">
        {children}
        <ToastContainer />
      </body>
    </html>
  );
}
