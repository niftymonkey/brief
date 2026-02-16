import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { deleteTag } from "@/lib/db";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tagId: string }> }
) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tagId } = await params;

  try {
    const deleted = await deleteTag(tagId, user.id);
    if (!deleted) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE TAG] Error:", error);
    return NextResponse.json({ error: "Failed to delete tag" }, { status: 500 });
  }
}
