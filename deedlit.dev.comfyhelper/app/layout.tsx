import type { Metadata } from "next";
import {
  IBM_Plex_Mono,
  Sora /*, Cinzel, Montserrat,*/,
} from "next/font/google";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import AppProviders from "@/lib/store/providers";
import "./globals.css";

const displayFont = Sora({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "deedlit.dev // ComfyUI Archive",
  description:
    "Personal studio archive for browsing ComfyUI PNG outputs and generation metadata.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialThemeScript = `
    (() => {
      try {
        const stored = window.localStorage.getItem("ui-theme");
        const resolved =
          stored === "light" || stored === "dark"
            ? stored
            : window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light";
        document.documentElement.setAttribute("data-theme", resolved);
      } catch {
        document.documentElement.setAttribute("data-theme", "light");
      }
    })();
  `;

  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initialThemeScript }} />
      </head>
      <body
        className={`${displayFont.variable} ${monoFont.variable} antialiased`}
      >
        <div className="min-h-screen px-1.5 py-3 pb-24 sm:px-6 sm:py-8 sm:pb-24 md:pl-24 md:pr-6 lg:px-8 lg:pl-24 2xl:px-12 2xl:pl-24">
          <ThemeToggleButton />
          <AppSidebar />
          <AppProviders>
            <div className="mx-auto w-full min-w-0">
              {children}
            </div>
          </AppProviders>
        </div>
      </body>
    </html>
  );
}
