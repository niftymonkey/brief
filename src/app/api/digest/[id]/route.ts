import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { deleteDigest } from "@/lib/db";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Digest ID is required" }, { status: 400 });
  }

  try {
    const deleted = await deleteDigest(user.id, id);

    if (!deleted) {
      return NextResponse.json({ error: "Digest not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE DIGEST] Error:", error);
    return NextResponse.json({ error: "Failed to delete digest" }, { status: 500 });
  }
}
