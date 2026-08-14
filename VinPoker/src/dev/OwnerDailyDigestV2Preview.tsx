import { useEffect, useState } from "react";
import { OwnerDigestAccessPanel } from "@/ops/digest/OwnerDigestAccessPanel";
import { OwnerDigestRegenerationButton } from "@/ops/digest/OwnerDigestRegenerationButton";
import { OwnerDailyDigestView, type OwnerDigestViewState } from "@/ops/digest/OwnerDailyDigestView";
import { OWNER_DIGEST_TEST_CLUB_A } from "@/ops/digest/ownerDailyDigestFixtures";
import { ownerDailyDigestV2FixtureSource } from "@/ops/digest/ownerDailyDigestV2Fixtures";

export default function OwnerDailyDigestV2Preview() {
  const [state, setState] = useState<OwnerDigestViewState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let current = true;
    setRefreshing(true);
    void ownerDailyDigestV2FixtureSource.loadSnapshot({ clubId: OWNER_DIGEST_TEST_CLUB_A })
      .then((result) => {
        if (current) setState(result.report ? { kind: "ready", report: result.report } : { kind: "empty" });
      })
      .catch(() => {
        if (current) setState({ kind: "error", code: "OWNER_DIGEST_PREVIEW_FAILED" });
      })
      .finally(() => {
        if (current) setRefreshing(false);
      });
    return () => { current = false; };
  }, [revision]);

  async function regenerate() {
    setRegenerating(true);
    try {
      await ownerDailyDigestV2FixtureSource.requestRegeneration(
        OWNER_DIGEST_TEST_CLUB_A,
        "2026-08-10",
        crypto.randomUUID(),
      );
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] px-3 py-5 sm:px-5 lg:px-8 lg:py-8">
      <OwnerDailyDigestView
        clubName="CLB thử nghiệm A"
        state={state}
        refreshing={refreshing}
        environmentLabel="LOCAL UI"
        onRefresh={() => setRevision((value) => value + 1)}
        generationNotice={{ tone: "info", text: "Preview local chỉ kiểm tra giao diện. Không kết nối Supabase hoặc dịch vụ gửi tin." }}
        extraActions={(
          <>
            <OwnerDigestAccessPanel clubId={OWNER_DIGEST_TEST_CLUB_A} source={ownerDailyDigestV2FixtureSource} />
            <OwnerDigestRegenerationButton reportDate="2026-08-10" busy={regenerating} onConfirm={() => void regenerate()} />
          </>
        )}
      />
    </main>
  );
}
