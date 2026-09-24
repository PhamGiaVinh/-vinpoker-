// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const { rpc, saveFailure } = vi.hoisted(() => ({
  saveFailure: { value: false },
  rpc: vi.fn(async (name: string) => {
    if (name === "save_tv_tournament_layout_v1" && saveFailure.value) throw new Error("offline");
    if (name === "can_edit_tv_tournament_layout_v1") return { data: true, error: null };
    if (name === "get_tv_tournament_branding_v1") return {
      data: { logo_url: null, background_url: null, brand_name: "VinPoker", layout: {}, revision: 7 },
      error: null,
    };
    return { data: { revision: 8 }, error: null };
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { tvLayoutEditorV1: true } }));
vi.mock("@/components/ProofUploader", () => ({ ProofUploader: () => <div>Image upload</div> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TvBrandingEditor } from "./TvBrandingEditor";
import { toast } from "sonner";

afterEach(() => { cleanup(); rpc.mockClear(); saveFailure.value = false; });

describe("TvBrandingEditor publish boundary", () => {
  it("keeps edits and reset in a local draft until Publish, then sends the loaded revision", async () => {
    render(<TvBrandingEditor tournamentId="flight-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit TV layout/i }));
    expect(await screen.findByText(/Draft 16:9 preview · not on TV/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText("Brand name"), { target: { value: "New brand" } });
    expect(rpc).not.toHaveBeenCalledWith("save_tv_tournament_layout_v1", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: /Reset draft to defaults/i }));
    expect(screen.getByLabelText("Brand name")).toHaveValue("");
    expect(rpc).not.toHaveBeenCalledWith("save_tv_tournament_layout_v1", expect.anything());

    fireEvent.change(screen.getByLabelText("Brand name"), { target: { value: "Final brand" } });
    fireEvent.click(screen.getByRole("button", { name: /Publish TV layout/i }));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith("save_tv_tournament_layout_v1", expect.objectContaining({
      p_tournament_id: "flight-1", p_expected_revision: 7, p_brand_name: "Final brand",
    })));
  });

  it("keeps the draft open and reports a rejected publish request", async () => {
    saveFailure.value = true;
    render(<TvBrandingEditor tournamentId="flight-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Edit TV layout/i }));
    expect(await screen.findByText(/Draft 16:9 preview/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Publish TV layout/i }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("could not be published")));
    expect(screen.getByRole("button", { name: /Publish TV layout/i })).toBeEnabled();
  });
});
