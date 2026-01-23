import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserTags } from "@/lib/db";

export async function GET() {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tags = await getUserTags(user.id);
    return NextResponse.json(tags);
  } catch (error) {
    console.error("[GET USER TAGS] Error:", error);
    return NextResponse.json({ error: "Failed to get tags" }, { status: 500 });
  }
}
