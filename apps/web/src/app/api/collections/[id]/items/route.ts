import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { z } from "zod";
import { addCollectionItem } from "@/lib/collections";

// Mirrors the video-id shape in @brief/core's parser (`/^[a-zA-Z0-9_-]{11}$/`).
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

const addItemSchema = z
  .object({
    videoId: z.string().regex(VIDEO_ID),
    startSec: z.number().int().nonnegative().optional(),
    endSec: z.number().int().nonnegative().optional(),
    summary: z.string().optional(),
  })
  .refine(
    (data) =>
      data.startSec === undefined ||
      data.endSec === undefined ||
      data.startSec <= data.endSec,
    { message: "startSec must be less than or equal to endSec", path: ["endSec"] },
  );

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
