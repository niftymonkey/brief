import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { z } from "zod";
import { createCollection, listCollections } from "@/lib/collections";
import { isEmailAllowed } from "@/lib/access";

const createCollectionSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
});

export async function GET() {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const collections = await listCollections(user.id);
    return NextResponse.json(collections);
  } catch (error) {
    console.error("[GET COLLECTIONS] Error:", error);
    return NextResponse.json({ error: "Failed to get collections" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Access restricted" }, { status: 403 });
  }

  try {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
    }

    const body = createCollectionSchema.safeParse(json);
    if (!body.success) {
      return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
    }

    const collection = await createCollection(user.id, body.data);
    return NextResponse.json(collection);
  } catch (error) {
    console.error("[CREATE COLLECTION] Error:", error);
    return NextResponse.json({ error: "Failed to create collection" }, { status: 500 });
  }
}
