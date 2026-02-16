import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";

export const dynamic = "force-dynamic";

export default async function PostLoginPage() {
  const { user } = await withAuth();

  if (!user) {
    redirect("/");
  }

  // Always redirect to unified homepage
  redirect("/");
}
