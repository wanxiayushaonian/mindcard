import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import { ToastContainer } from "@/lib/toast";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: "metadata",
  });
  return {
    title: t("title"),
    description: t("description"),
    icons: {
      icon: [
        { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon.ico", sizes: "48x48" },
      ],
      apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
      other: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      images: [{ url: "/og-image.png", width: 1200, height: 1200 }],
    },
  };
}

export default async function RootLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const messages = await getMessages();

  // Server-side theme so React's virtual DOM matches the real class list.
  // The inline script below keeps the first paint correct (no flash) and
  // persists its system-preference inference to the same cookie, so a
  // router.refresh() (e.g. locale switch) re-renders <html> with the right
  // className instead of resetting the manually-added `.dark`.
  const theme = cookies().get("theme")?.value;
  const isDark = theme === "dark";

  return (
    <html lang={locale} className={isDark ? "dark" : ""} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var m = document.cookie.match(/theme=([^;]+)/);
                var t = m ? m[1] : null;
                if (!t) {
                  var stored = localStorage.getItem('theme');
                  if (stored) t = stored;
                }
                // Light by default; dark only when the user explicitly chose it.
                if (t === 'dark') document.documentElement.classList.add('dark');
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-bg text-text">
        <NextIntlClientProvider messages={messages}>
          {children}
          <ToastContainer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
