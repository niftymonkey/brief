import { Lock } from "lucide-react";

export function AccessRestricted() {
  return (
    <div className="max-w-2xl mx-auto text-center space-y-6 py-6 md:py-8">
      <h1 className="text-4xl md:text-5xl text-[var(--color-text-primary)] font-semibold tracking-tight">
        Your YouTube, indexed
      </h1>

      <div className="mt-8 p-6 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-[var(--color-bg-tertiary)]">
            <Lock className="w-6 h-6 text-[var(--color-text-secondary)]" />
          </div>
        </div>

        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
          Coming Soon
        </h2>

        <p className="text-[var(--color-text-secondary)] mb-4">
          Brief generation is currently limited to early access users.
        </p>

        <p className="text-sm text-[var(--color-text-tertiary)]">
          We&apos;re working on Bring Your Own Key (BYOK) support, which will
          let you use your own API keys to generate briefs. Stay tuned!
        </p>
      </div>
    </div>
  );
}
