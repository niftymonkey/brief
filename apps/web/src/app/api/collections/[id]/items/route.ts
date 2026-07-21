import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { z } from "zod";
import { addCollectionItem } from "@/lib/collections";

const addItemSchema = z.object({
  videoId: z.string().min(1),
  startSec: z.number().int().optional(),
  endSec: z.number().int().optional(),
  summary: z.string().optional(),
});

export async function POST(
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
      return NextResponse.json({ error: "Invalid collection item" }, { status: 400 });
    }

    const body = addItemSchema.safeParse(json);
    if (!body.success) {
      return NextResponse.json({ error: "Invalid collection item" }, { status: 400 });
    }

    const item = await addCollectionItem(user.id, id, body.data);
    if (!item) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    console.error("[ADD COLLECTION ITEM] Error:", error);
    return NextResponse.json({ error: "Failed to add collection item" }, { status: 500 });
  }
}
