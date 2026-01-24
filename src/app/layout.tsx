import type { Metadata } from "next";
import {
  Plus_Jakarta_Sans,
  Source_Sans_3,
  JetBrains_Mono,
} from "next/font/google";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/theme-provider";
import { LayoutProvider } from "@/components/layout";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
});

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "YouTube Digest",
  description: "Quickly understand any YouTube video. AI-powered summaries, timestamps, and extracted links.",
  openGraph: {
    title: "YouTube Digest",
    description: "Quickly understand any YouTube video. AI-powered summaries, timestamps, and extracted links.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${plusJakartaSans.variable} ${sourceSans3.variable} ${jetbrainsMono.variable}`}
    >
      <body className="antialiased min-h-screen bg-[var(--color-bg-primary)]">
        <AuthKitProvider>
          <NuqsAdapter>
            <ThemeProvider
              attribute="class"
              defaultTheme="dark"
              enableSystem
              disableTransitionOnChange
            >
              <LayoutProvider>
                <div className="flex flex-col min-h-screen">
                  {children}
                </div>
              </LayoutProvider>
            </ThemeProvider>
          </NuqsAdapter>
        </AuthKitProvider>
      </body>
    </html>
  );
}
