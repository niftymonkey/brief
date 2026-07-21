import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { z } from "zod";
import { InvalidClipRangeError, deleteCollectionItem, updateCollectionItem } from "@/lib/collections";

// Mirrors the video-id shape in @brief/core's parser (`/^[a-zA-Z0-9_-]{11}$/`).
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

const updateItemSchema = z
  .object({
    summary: z.string().nullable().optional(),
    videoId: z.string().regex(VIDEO_ID).optional(),
    startSec: z.number().int().nonnegative().nullable().optional(),
    endSec: z.number().int().nonnegative().nullable().optional(),
    beforeItemId: z.string().nullable().optional(),
    afterItemId: z.string().nullable().optional(),
  })
  .refine(
    (data) =>
      data.startSec === undefined ||
      data.startSec === null ||
      data.endSec === undefined ||
      data.endSec === null ||
      data.startSec <= data.endSec,
    { message: "startSec must be less than or equal to endSec", path: ["endSec"] },
  );

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { user } = await withAuth();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, itemId } = await params;

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid collection item" }, { status: 400 });
    }

    const body = updateItemSchema.safeParse(json);
    if (!body.success) {
      return NextResponse.json({ error: "Invalid collection item" }, { status: 400 });
    }

    const item = await updateCollectionItem(user.id, id, itemId, body.data);
    if (!item) {
      return NextResponse.json({ error: "Collection item not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    if (error instanceof InvalidClipRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[UPDATE COLLECTION ITEM] Error:", error);
    return NextResponse.json({ error: "Failed to update collection item" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { user } = await withAuth();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, itemId } = await params;

    const deleted = await deleteCollectionItem(user.id, id, itemId);
    if (!deleted) {
      return NextResponse.json({ error: "Collection item not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE COLLECTION ITEM] Error:", error);
    return NextResponse.json({ error: "Failed to delete collection item" }, { status: 500 });
  }
}
