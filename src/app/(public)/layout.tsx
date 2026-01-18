import Link from "next/link";
import { Youtube } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg-primary)]/80">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
          >
            <Youtube className="w-5 h-5" />
            <span className="font-semibold">YouTube Digest</span>
          </Link>

          <div className="flex items-center gap-4">
            <Link
              href="/auth"
              prefetch={false}
              className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Sign In
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
