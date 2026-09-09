import type { ReactNode } from "react";

interface TopicSectionProps {
  title: string;
  /** One line saying what this part of the Topic decides. */
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}

/** The card chrome every part of a Topic's page sits in. */
export function TopicSection({ title, description, action, children }: TopicSectionProps) {
  return (
    <section className="p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-medium text-[var(--color-text-primary)]">{title}</h3>
          {description && (
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
