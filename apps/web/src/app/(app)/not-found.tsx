import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="font-serif text-4xl text-[var(--color-text-primary)] mb-4">
          Page not found
        </h1>
        <p className="text-[var(--color-text-secondary)] mb-6">
          The page you're looking for doesn't exist.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
