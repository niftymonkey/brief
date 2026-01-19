import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

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
      className={`${GeistSans.variable} ${GeistMono.variable}`}
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
              <div className="flex flex-col min-h-screen">
                {children}
              </div>
            </ThemeProvider>
          </NuqsAdapter>
        </AuthKitProvider>
      </body>
    </html>
  );
}
