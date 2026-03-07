import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { ThemeToggleButton } from "@/components/layout/ThemeToggleButton";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import "./globals.css";

const themeInitScript = `
(() => {
  try {
    const match = document.cookie.match(/(?:^|; )deedlit-theme=(dark|light)/);
    const stored = match ? match[1] : null;
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const resolved = stored || preferred;
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  } catch {}
})();
`;

const display = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"]
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"]
});

export const metadata: Metadata = {
  metadataBase: new URL("https://deedlit.dev"),
  title: {
    default: "deedlit.dev | Personal Space",
    template: "%s | deedlit.dev"
  },
  description: "My personal space for AI-generated art, book collection, and creative projects. Featuring ComfyUI-generated images, organized book library, and hobby projects.",
  keywords: ["ComfyUI", "AI art", "image generation", "book collection", "SDXL", "Flux", "creative projects", "personal library"],
  authors: [{ name: "deedlit.dev" }],
  creator: "deedlit.dev",
  publisher: "deedlit.dev",
  alternates: {
    canonical: "/"
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  manifest: "/manifest.webmanifest",
  applicationName: "deedlit.dev",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "deedlit.dev"
  },
  formatDetection: {
    telephone: false
  },
  openGraph: {
    type: "website",
    url: "https://deedlit.dev",
    title: "deedlit.dev - Personal Creative Space",
    description: "AI-generated art gallery, book collection, and creative projects. ComfyUI images, organized library, and hobbies.",
    siteName: "deedlit.dev",
    locale: "en_US",
    images: [
      {
        url: "/images/og-cover.svg",
        width: 1200,
        height: 630,
        alt: "deedlit.dev - personal creative space preview"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "deedlit.dev - Personal Creative Space",
    description: "AI-generated art, book collection, and creative projects.",
    images: ["/images/og-cover.svg"],
    creator: "@deedlit_dev"
  },
  verification: {
    // Add verification tokens here when ready
    // google: 'your-google-verification-code',
    // yandex: 'your-yandex-verification-code',
  },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c13" }
  ]
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${display.variable} ${mono.variable} font-[var(--font-display)] antialiased`}
      >
        <div className="min-h-screen px-1.5 py-3 pb-24 sm:px-6 sm:py-8 sm:pb-24 md:pl-24 md:pr-6 lg:px-8 lg:pl-24 2xl:px-12 2xl:pl-24">
          <ThemeToggleButton />
          <AppSidebar />
          <ServiceWorkerRegistration />
          {children}
        </div>
      </body>
    </html>
  );
}
