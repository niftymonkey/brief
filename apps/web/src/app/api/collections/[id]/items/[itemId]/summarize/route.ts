import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { isEmailAllowed } from "@/lib/access";
import { createClipWordsDeps, writeClipWords } from "@/lib/clip-words";

/**
 * Writes a clip's outstanding words on request, and answers with the clip. The
 * add and edit routes already schedule this after their response, so the page
 * calls it only to retry a clip whose generation failed.
 *
 * Idempotent: a clip already 'ready' is returned unchanged, so a re-run or a
 * retry against hand-edited words never clobbers them. A generation failure
 * marks the clip 'failed' and still answers 200, because a failed note is a
 * state the author can retry or write over, not an error.
 *
 * This route is an addition beyond the originally approved collections API
 * contract. See the review packet's contract-amendment note.
 */

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { user } = await withAuth();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Writing a clip's words spends LLM tokens per call, so this endpoint is
    // allowlist-gated like the brief-generation routes. Owner-scoped collection
    // CRUD stays withAuth-only; only the token-spending path carries the allowlist.
    if (!isEmailAllowed(user.email)) {
      return NextResponse.json({ error: "Access restricted" }, { status: 403 });
    }

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      console.error("[CLIP WORDS] Missing OPENROUTER_API_KEY");
      return NextResponse.json({ error: "Summarization is unavailable" }, { status: 503 });
    }

    const { id, itemId } = await params;
    const item = await writeClipWords(user.id, id, itemId, createClipWordsDeps(openRouterKey));
    if (!item) {
      return NextResponse.json({ error: "Collection item not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    console.error("[CLIP WORDS] Error:", error);
    return NextResponse.json({ error: "Failed to summarize item" }, { status: 500 });
  }
}
