import Link from "next/link";
import { withAuth, signOut } from "@workos-inc/authkit-nextjs";
import { Youtube } from "lucide-react";
import { isEmailAllowed } from "@/lib/access";
import { NewDigestDialog } from "./new-digest-dialog";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

async function signOutAction() {
  "use server";
  await signOut();
}

export async function Header() {
  const { user } = await withAuth();
  const hasAccess = isEmailAllowed(user?.email);

  return (
    <header className="sticky top-0 z-50 px-4 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg-primary)]/80">
      <div className="max-w-5xl mx-auto h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors">
          <Youtube className="w-5 h-5" />
          <span className="font-semibold">YouTube Digest</span>
        </Link>

        <div className="flex items-center gap-4">
          {user && hasAccess && <NewDigestDialog />}
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
        </div>
      </div>
    </header>
  );
}
