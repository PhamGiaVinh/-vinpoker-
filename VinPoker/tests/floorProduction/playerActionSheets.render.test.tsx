import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PlayerActionSheets } from "@/components/ops/shared/PlayerActionSheets";

afterEach(cleanup);

describe("PlayerActionSheets", () => {
  it("renders its closed receipt sheet without a missing icon reference", () => {
    expect(() => render(
      <PlayerActionSheets
        target={null}
        onClose={vi.fn()}
        onSaveChip={async () => false}
        onBustPlayer={async () => false}
        onOpenBust={vi.fn()}
        bustInfo={null}
        moveTargets={[]}
        onMovePlayer={async () => false}
        onOpenReceipt={vi.fn()}
        infoLive
      />,
    )).not.toThrow();
  });
});
