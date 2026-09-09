import Link from "next/link";
import { Layers, Radar } from "lucide-react";
import { withAuth, signOut } from "@workos-inc/authkit-nextjs";
import { isEmailAllowed } from "@/lib/access";
import { NewBriefDialog } from "./new-brief-dialog";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { HeaderContent } from "./header-content";

async function signOutAction() {
  "use server";
  await signOut();
}

export async function Header() {
  const { user } = await withAuth();
  const hasAccess = isEmailAllowed(user?.email);

  return (
    <header className="sticky top-0 z-50 px-4 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg-primary)]/80">
      <HeaderContent
        nav={
          user && (
            <>
              <Link
                href="/collections"
                className="inline-flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <Layers className="w-4 h-4 shrink-0" />
                <span className="sr-only min-[520px]:not-sr-only">Collections</span>
              </Link>
              <Link
                href="/topics"
                className="inline-flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <Radar className="w-4 h-4 shrink-0" />
                <span className="sr-only min-[520px]:not-sr-only">Topics</span>
              </Link>
            </>
          )
        }
      >
        {user && hasAccess && <NewBriefDialog collapseLabelWhenNarrow />}
        {user && (
          <UserMenu
            user={{
              email: user.email ?? "",
              firstName: user.firstName,
              lastName: user.lastName,
              profilePictureUrl: user.profilePictureUrl,
            }}
            signOutAction={signOutAction}
          />
        )}
        <ThemeToggle />
      </HeaderContent>
    </header>
  );
}
