import { withAuth, signOut } from "@workos-inc/authkit-nextjs";
import { HeaderContent } from "@/components/header-content";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

async function signOutAction() {
  "use server";
  await signOut();
}

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await withAuth({ ensureSignedIn: false });

  return (
    <>
      <header className="sticky top-0 z-50 px-4 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg-primary)]/80">
        <HeaderContent>
          {user ? (
            <UserMenu
              user={{
                email: user.email ?? "",
                firstName: user.firstName,
                lastName: user.lastName,
                profilePictureUrl: user.profilePictureUrl,
              }}
              signOutAction={signOutAction}
            />
          ) : (
            <a
              href="/auth"
              className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Sign In
            </a>
          )}
          <ThemeToggle />
        </HeaderContent>
      </header>
      {children}
    </>
  );
}
