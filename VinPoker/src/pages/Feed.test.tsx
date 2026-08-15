import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type DbResponse = { data?: unknown; error?: unknown };

const state = vi.hoisted(() => ({
  responses: {} as Record<string, DbResponse>,
  feedPostReads: 0,
  likeInsert: vi.fn(),
}));
const AUTH = vi.hoisted(() => ({ user: { id: "user-a", email: "a@example.test" }, loading: false }));

function queryFor(table: string) {
  const response = () => state.responses[table] ?? { data: [], error: null };
  const query: Record<string, any> = {};
  for (const method of ["select", "eq", "order", "limit", "in", "gte"]) {
    query[method] = vi.fn(() => query);
  }
  query.insert = table === "feed_post_likes"
    ? state.likeInsert
    : vi.fn(() => Promise.resolve({ data: null, error: null }));
  query.delete = vi.fn(() => query);
  query.upsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
  query.then = (resolve: (value: DbResponse) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(response()).then(resolve, reject);
  return query;
}

const supabase = vi.hoisted(() => ({
  from: vi.fn((table: string) => {
    if (table === "feed_posts") state.feedPostReads += 1;
    return queryFor(table);
  }),
  channel: vi.fn(() => {
    const channel: Record<string, any> = {};
    channel.on = vi.fn(() => channel);
    channel.subscribe = vi.fn(() => channel);
    return channel;
  }),
  removeChannel: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => AUTH,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "feed.title": "News Feed",
      "feed.yourStory": "Your story",
      "feed.addStory": "Add story",
      "feed.sharePrompt": "What would you like to share?",
      "feed.empty": "No posts yet. Be the first to share.",
      "feed.loadError": "We couldn't load the News Feed. Please try again.",
      "feed.retry": "Try again",
      "feed.like": "Like post",
      "feed.anonymousPlayer": "Anonymous player",
      "feed.ago": "ago",
      "timeAgo.justNow": "just now",
      "feed.comment.placeholder": "Write a comment...",
      "feed.comment.send": "Send",
    }[key] ?? key),
  }),
}));
vi.mock("@/components/feed/CreateStoryMultiDialog", () => ({ CreateStoryMultiDialog: () => null }));
vi.mock("@/components/feed/StoryViewersDialog", () => ({ StoryViewersDialog: () => null }));
vi.mock("@/components/poker/CardSlot", () => ({
  CardSlot: () => null,
  cardToSymbol: (card: string) => card,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import Feed from "./Feed";

function renderFeed() {
  return render(<MemoryRouter><Feed /></MemoryRouter>);
}

function resetResponses() {
  state.responses = {
    feed_posts: { data: [], error: null },
    feed_stories: { data: [], error: null },
    profiles: { data: [], error: null },
    feed_post_likes: { data: [], error: null },
    feed_story_views: { data: [], error: null },
  };
  state.feedPostReads = 0;
  state.likeInsert.mockReset();
  state.likeInsert.mockResolvedValue({ data: null, error: null });
  supabase.from.mockClear();
  supabase.channel.mockClear();
  supabase.removeChannel.mockClear();
}

function addVisiblePost() {
  state.responses.feed_posts = {
    data: [{
      id: "post-1",
      author_id: "author-1",
      content: "Post stays visible",
      post_type: "general",
      poker_hand: null,
      media_urls: [],
      like_count: 0,
      comment_count: 0,
      created_at: new Date().toISOString(),
    }],
    error: null,
  };
  state.responses.profiles = { data: [{ user_id: "author-1", display_name: "Player A", avatar_url: null }], error: null };
}

beforeEach(resetResponses);
afterEach(cleanup);

describe("Feed loading resilience", () => {
  it("ends loading and offers retry when posts cannot load", async () => {
    state.responses.feed_posts = { data: null, error: new Error("relation missing") };
    renderFeed();

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load the News Feed");

    state.responses.feed_posts = { data: [], error: null };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("No posts yet. Be the first to share.")).toBeInTheDocument();
    expect(state.feedPostReads).toBeGreaterThanOrEqual(2);
  });

  it("keeps posts usable when Stories fail separately", async () => {
    addVisiblePost();
    state.responses.feed_stories = { data: null, error: new Error("stories unavailable") };
    renderFeed();

    expect(await screen.findByText("Post stays visible")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends one like mutation for a double click and updates only after success", async () => {
    addVisiblePost();
    let resolveLike: ((value: DbResponse) => void) | undefined;
    state.likeInsert.mockImplementation(() => new Promise<DbResponse>((resolve) => { resolveLike = resolve; }));
    renderFeed();

    const likeButton = await screen.findByRole("button", { name: "Like post" });
    fireEvent.click(likeButton);
    fireEvent.click(likeButton);

    await waitFor(() => expect(state.likeInsert).toHaveBeenCalledTimes(1));
    expect(likeButton).toHaveTextContent("0");

    resolveLike?.({ data: null, error: null });
    await waitFor(() => expect(likeButton).toHaveTextContent("1"));
  });
});
