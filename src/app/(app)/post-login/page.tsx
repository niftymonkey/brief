import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { hasDigests } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PostLoginPage() {
  const { user } = await withAuth();

  if (!user) {
    redirect("/");
  }

  const digestsExist = await hasDigests(user.id);

  if (digestsExist) {
    redirect("/digests");
  } else {
    redirect("/home");
  }
}
