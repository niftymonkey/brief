import { withAuth, signOut } from "@workos-inc/authkit-nextjs";
import { isEmailAllowed } from "@/lib/access";
import { NewDigestDialog } from "./new-digest-dialog";
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
      <HeaderContent>
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
      </HeaderContent>
    </header>
  );
}
