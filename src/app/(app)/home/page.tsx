import { withAuth } from "@workos-inc/authkit-nextjs";
import { isEmailAllowed } from "@/lib/access";
import { HomeContent } from "@/components/home-content";
import { AccessRestricted } from "@/components/access-restricted";

export default async function Home() {
  const { user } = await withAuth();
  const hasAccess = isEmailAllowed(user?.email);

  return (
    <main className="flex-1 px-4 py-4 md:py-8">
      {hasAccess ? <HomeContent /> : <AccessRestricted />}
    </main>
  );
}
