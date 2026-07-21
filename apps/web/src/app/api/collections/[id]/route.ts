import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { z } from "zod";
import {
  deleteCollection,
  getCollectionWithItems,
  updateCollection,
} from "@/lib/collections";

const updateCollectionSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const collection = await getCollectionWithItems(user.id, id);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    return NextResponse.json(collection);
  } catch (error) {
    console.error("[GET COLLECTION] Error:", error);
    return NextResponse.json({ error: "Failed to get collection" }, { status: 500 });
  }
}

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
      return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
    }

    const body = updateCollectionSchema.safeParse(json);
    if (!body.success) {
      return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
    }

    const collection = await updateCollection(user.id, id, body.data);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    return NextResponse.json(collection);
  } catch (error) {
    console.error("[UPDATE COLLECTION] Error:", error);
    return NextResponse.json({ error: "Failed to update collection" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const deleted = await deleteCollection(user.id, id);
    if (!deleted) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE COLLECTION] Error:", error);
    return NextResponse.json({ error: "Failed to delete collection" }, { status: 500 });
  }
}
