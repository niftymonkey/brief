import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { removeTagFromBrief } from "@/lib/db";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, tagId } = await params;

  if (!id || !tagId) {
    return NextResponse.json(
      { error: "Brief ID and Tag ID are required" },
      { status: 400 }
    );
  }

  try {
    const removed = await removeTagFromBrief(user.id, id, tagId);

    if (!removed) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[REMOVE TAG] Error:", error);
    return NextResponse.json({ error: "Failed to remove tag" }, { status: 500 });
  }
}
