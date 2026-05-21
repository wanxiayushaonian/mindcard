import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MindCard - 灵感卡片",
  description: "Manage your inspiration cards with AI-powered search and RAG",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-bg">{children}</body>
    </html>
  );
}
