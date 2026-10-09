import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/storyMusicOptionalClient", () => ({ storyMusicOptionalClient: {
  from: () => ({ select: () => ({ order: mocks.read }) }),
} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  storage: { from: () => ({ upload: mocks.upload }) },
} }));
import { StoryMusicManager } from "./StoryMusicManager";
afterEach(cleanup);
beforeEach(() => { mocks.read.mockReset(); mocks.upload.mockReset(); });
describe("optional music backend", () => {
  it("shows a missing backend as an error, not an empty library, and prevents upload", async () => {
    mocks.read.mockResolvedValue({ data: null, error: { code: "42P01" } });
    render(<StoryMusicManager />);
    expect(await screen.findByRole("alert")).toHaveTextContent("chưa sẵn sàng");
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("ends loading and reports a network rejection", async () => {
    mocks.read.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<StoryMusicManager />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không kết nối");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
