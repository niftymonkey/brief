// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SharedCollectionPage from "./page";
import { VIDEO_FACTS, makeCollection } from "@/test/collection-playback-harness";

interface FakeViewer {
  user: { id: string; email: string } | null;
  allowed: boolean;
  collectionCount: number;
}

const viewer = vi.hoisted(
  (): FakeViewer => ({
    user: null,
    allowed: false,
    collectionCount: 0,
  }),
);

vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: async () => ({ user: viewer.user }),
}));

vi.mock("@/lib/access", () => ({
  isEmailAllowed: (email: string | undefined | null) => Boolean(email) && viewer.allowed,
}));

vi.mock("@/lib/collections", () => ({
  getSharedCollectionBySlug: async () => makeCollection(),
  getSharedCollectionVideoFacts: async () => VIDEO_FACTS,
  listCollections: async () =>
    Array.from({ length: viewer.collectionCount }, (_, index) => ({ id: `owned-${index}` })),
}));

vi.mock("@/lib/youtube-iframe-api", () => ({
  loadYouTubeIframeApi: () => Promise.resolve(),
}));

const INVITATION = "Build your own collections from AI summaries of any YouTube video.";

async function renderPage(): Promise<void> {
  const page = await SharedCollectionPage({ params: Promise.resolve({ slug: "a-sitting" }) });
  render(page);
}

function signIn(allowed: boolean, collectionCount: number): void {
  viewer.user = { id: "user-1", email: "reader@example.test" };
  viewer.allowed = allowed;
  viewer.collectionCount = collectionCount;
}

function expectNoInvitation(): void {
  expect(screen.queryByRole("link", { name: "Get Started" })).toBeNull();
  expect(screen.queryByText(INVITATION)).toBeNull();
  // Nothing is left behind in their place: the article holds only the collection,
  // and the collection ends at its own section, with no shelf footer after it.
  const article = document.querySelector("article");
  expect(article?.childElementCount).toBe(1);
  expect(article?.firstElementChild?.lastElementChild?.tagName).toBe("SECTION");
}

beforeEach(() => {
  viewer.user = null;
  viewer.allowed = false;
  viewer.collectionCount = 0;
});

afterEach(cleanup);

// Media queries do not resolve in jsdom, so both invitations are in the document;
// the wide layout's CSS shows the shelf's and hides the box under the article.
describe("Shared collection page invitation", () => {
  it("invites an allowed viewer with no collections to Get Started from the shelf and the box", async () => {
    signIn(true, 0);
    await renderPage();

    const links = screen.getAllByRole("link", { name: "Get Started" });
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.getAttribute("href") === "/collections")).toBe(true);

    const [shelfLink, boxLink] = [
      links.find((link) => link.closest("article section") === null),
      links.find((link) => link.closest("article section") !== null),
    ];
    expect(shelfLink).toBeTruthy();
    expect(boxLink).toBeTruthy();
    expect(screen.getAllByText(INVITATION)).toHaveLength(2);
  });

  it("offers Get Started as a text link at every width, so Play is the only filled call to action", async () => {
    signIn(true, 0);
    await renderPage();

    for (const link of screen.getAllByRole("link", { name: "Get Started" })) {
      expect(link.className).not.toMatch(/(^|\s)bg-/);
      expect(link.className).toContain("text-[var(--color-accent-hover)]");
      expect(link.className).toContain("dark:text-[var(--color-accent)]");
    }
  });

  it("shows a signed-out reader no invitation", async () => {
    await renderPage();
    expectNoInvitation();
  });

  it("shows a signed-in viewer who cannot build collections no invitation", async () => {
    signIn(false, 0);
    await renderPage();
    expectNoInvitation();
  });

  it("shows a viewer who already has collections no invitation", async () => {
    signIn(true, 2);
    await renderPage();
    expectNoInvitation();
  });
});
