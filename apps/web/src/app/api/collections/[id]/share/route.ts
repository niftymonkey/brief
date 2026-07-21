import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { z } from "zod";
import { setCollectionShared } from "@/lib/collections";

const shareSchema = z.object({
  isShared: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "isShared must be a boolean" }, { status: 400 });
    }

    const body = shareSchema.safeParse(json);
    if (!body.success) {
      return NextResponse.json({ error: "isShared must be a boolean" }, { status: 400 });
    }

    const result = await setCollectionShared(user.id, id, body.data.isShared);
    if (!result) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[SHARE COLLECTION] Error:", error);
    return NextResponse.json({ error: "Failed to update sharing" }, { status: 500 });
  }
}
