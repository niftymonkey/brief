import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { addTagToDigest, getDigestTags } from "@/lib/db";

export async function GET(
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
    const tags = await getDigestTags(id);
    return NextResponse.json(tags);
  } catch (error) {
    console.error("[GET DIGEST TAGS] Error:", error);
    return NextResponse.json({ error: "Failed to get tags" }, { status: 500 });
  }
}

export async function POST(
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
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Tag name is required" }, { status: 400 });
    }

    const tag = await addTagToDigest(user.id, id, name);
    return NextResponse.json(tag);
  } catch (error) {
    console.error("[ADD TAG] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to add tag";
    const status = message.includes("not found") ? 404 :
                   message.includes("Maximum") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
