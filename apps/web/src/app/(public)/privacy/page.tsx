import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Brief",
  description:
    "Privacy policy for Brief — the web app and Chrome extension for AI-powered YouTube video summaries.",
};

export default function PrivacyPage() {
  return (
    <main className="flex-1 px-4 py-8">
      <article className="max-w-3xl mx-auto space-y-8">
        <header>
          <h1 className="text-2xl md:text-3xl font-semibold text-[var(--color-text-primary)] mb-2">
            Privacy Policy
          </h1>
          <p className="text-[var(--color-text-secondary)]">
            Effective date: February 19, 2026
          </p>
        </header>

        {/* 1. Introduction */}
        <Section title="Introduction">
          <p>
            Brief (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;)
            provides an AI-powered YouTube video summarization service available
            as a web application at{" "}
            <a
              href="https://brief.niftymonkey.dev"
              className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
            >
              brief.niftymonkey.dev
            </a>{" "}
            and as a Chrome browser extension. This privacy policy explains what
            information we collect, how we use it, and the choices you have.
          </p>
        </Section>

        {/* 2. Information We Collect */}
        <Section title="Information We Collect">
          <h3 className="font-medium text-[var(--color-text-primary)] mt-4 mb-2">
            Account information
          </h3>
          <p>
            When you sign in, we receive basic identity information from our
            authentication provider (WorkOS), such as your name, email address,
            and profile picture. We use this solely to identify your account and
            display your profile in the app.
          </p>

          <h3 className="font-medium text-[var(--color-text-primary)] mt-4 mb-2">
            YouTube video data
          </h3>
          <p>
            When you create a brief, we receive the YouTube video URL you
            submit. We use a third-party transcript service (Supadata) to fetch
            the video transcript, and an AI model (Anthropic Claude) to generate
            a summary. The resulting brief&mdash;including the video title,
            channel name, duration, summary, timestamped sections, and extracted
            links&mdash;is stored on our servers and associated with your
            account.
          </p>

          <h3 className="font-medium text-[var(--color-text-primary)] mt-4 mb-2">
            Chrome extension local data
          </h3>
          <p>
            The Brief Chrome extension stores a small amount of data locally on
            your device using{" "}
            <code className="text-sm bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded">
              chrome.storage.local
            </code>
            . This includes the URLs and titles of your five most recent video
            submissions, along with their processing status. This data never
            leaves your device and is automatically removed when you uninstall
            the extension.
          </p>
        </Section>

        {/* 3. How We Use Your Information */}
        <Section title="How We Use Your Information">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Summarization:</strong> We process YouTube video
              transcripts to generate AI-powered summaries, timestamps, and
              extracted links.
            </li>
            <li>
              <strong>Authentication:</strong> We use your account information to
              manage access and display your profile.
            </li>
            <li>
              <strong>Notifications:</strong> The Chrome extension may show
              browser notifications when a brief finishes processing. You can
              disable notifications in your browser settings at any time.
            </li>
          </ul>
          <p className="mt-3">
            We do not use your data for advertising, analytics profiling, or any
            purpose other than providing the Brief service.
          </p>
        </Section>

        {/* 4. Third-Party Services */}
        <Section title="Third-Party Services">
          <p className="mb-3">
            Brief relies on the following third-party services to operate. Each
            service has its own privacy policy governing how it handles data:
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <ExtLink href="https://workos.com/privacy">WorkOS</ExtLink>{" "}
              &mdash; authentication and user identity
            </li>
            <li>
              <ExtLink href="https://supadata.ai/privacy-policy">
                Supadata
              </ExtLink>{" "}
              &mdash; YouTube transcript retrieval
            </li>
            <li>
              <ExtLink href="https://www.anthropic.com/privacy">
                Anthropic
              </ExtLink>{" "}
              &mdash; AI summarization (Claude)
            </li>
            <li>
              <ExtLink href="https://vercel.com/legal/privacy-policy">
                Vercel
              </ExtLink>{" "}
              &mdash; hosting and deployment
            </li>
          </ul>
        </Section>

        {/* 5. Chrome Extension Permissions */}
        <Section title="Chrome Extension Permissions Explained">
          <p className="mb-3">
            The Brief Chrome extension requests the following permissions:
          </p>
          <dl className="space-y-3">
            <PermissionItem term="activeTab">
              Allows the extension to read the URL and title of the current tab
              when you click the extension icon&mdash;used to detect YouTube
              videos and pre-fill the submission form.
            </PermissionItem>
            <PermissionItem term="storage">
              Used to store your five most recent brief submissions locally on
              your device. No data is synced to other devices.
            </PermissionItem>
            <PermissionItem term="notifications">
              Allows the extension to show a browser notification when a brief
              finishes processing in the background.
            </PermissionItem>
            <PermissionItem term="cookies">
              Used to read the authentication session cookie so the extension can
              make authenticated requests to the Brief API on your behalf.
            </PermissionItem>
            <PermissionItem term="host_permissions">
              The extension communicates with{" "}
              <code className="text-sm bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded">
                brief.niftymonkey.dev
              </code>{" "}
              (the Brief API) and reads tab URLs on{" "}
              <code className="text-sm bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded">
                youtube.com
              </code>{" "}
              to detect video pages.
            </PermissionItem>
          </dl>
        </Section>

        {/* 6. Data Sharing */}
        <Section title="Data Sharing">
          <p>
            We do not sell, rent, or share your personal information with third
            parties for advertising or marketing purposes. Data is only shared
            with the third-party services listed above as necessary to provide
            the Brief service.
          </p>
        </Section>

        {/* 7. Data Retention */}
        <Section title="Data Retention">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Server-side data:</strong> Your briefs and account
              information are retained as long as your account exists. You can
              delete individual briefs at any time from the Brief library.
            </li>
            <li>
              <strong>Extension local data:</strong> Data stored by the Chrome
              extension is automatically cleared when you uninstall the
              extension.
            </li>
          </ul>
        </Section>

        {/* 8. Cookies */}
        <Section title="Cookies">
          <p>
            Brief uses a single session cookie (
            <code className="text-sm bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded">
              wos-session
            </code>
            ) to maintain your authentication state. We do not use tracking
            cookies, analytics cookies, or any third-party cookie-based
            tracking.
          </p>
        </Section>

        {/* 9. Contact */}
        <Section title="Contact">
          <p>
            If you have questions about this privacy policy or your data, you
            can reach us at{" "}
            <a
              href="mailto:mark.d.lozano+brief.privacy@gmail.com"
              className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
            >
              mark.d.lozano+brief.privacy@gmail.com
            </a>
            .
          </p>
        </Section>

        {/* 10. Changes to This Policy */}
        <Section title="Changes to This Policy">
          <p>
            We may update this privacy policy from time to time. When we do, we
            will revise the effective date at the top of this page. Continued use
            of Brief after changes constitutes acceptance of the updated policy.
          </p>
        </Section>
      </article>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1.5 pb-1 border-b border-[var(--color-border)]">
        {title}
      </h2>
      <div className="text-[var(--color-text-secondary)] leading-relaxed pt-2 space-y-2">
        {children}
      </div>
    </section>
  );
}

function ExtLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
    >
      {children}
    </a>
  );
}

function PermissionItem({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-medium text-[var(--color-text-primary)]">
        <code className="text-sm bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded">
          {term}
        </code>
      </dt>
      <dd className="mt-1 ml-4">{children}</dd>
    </div>
  );
}
