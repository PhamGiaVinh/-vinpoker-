import { useState } from "react";
import { HandEditPanel } from "@/components/cashier/tournament-live/HandEditPanel";
import type { HandEditPatch } from "@/components/cashier/tournament-live/handEditDiff";
import type { ExpectedHandEndStack } from "@/components/cashier/tournament-live/resettleApply";

const PLAYERS = [
  { player_id: "preview-s1", entry_number: 1, display_name: "Test 1", seat_number: 1, starting_stack: 2_000_000, ending_stack: 2_800_000, hole_cards: ["Ah", "Kd"] },
  { player_id: "preview-s2", entry_number: 1, display_name: "Test 2", seat_number: 2, starting_stack: 2_000_000, ending_stack: 1_500_000, hole_cards: [] },
  { player_id: "preview-s3", entry_number: 1, display_name: "Test 3", seat_number: 3, starting_stack: 2_000_000, ending_stack: 1_700_000, hole_cards: [] },
  { player_id: "preview-s4", entry_number: 1, display_name: "Test 4", seat_number: 4, starting_stack: 2_000_000, ending_stack: 2_000_000, hole_cards: [] },
];

const ACTIONS = [
  { player_id: "preview-s2", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 50_000, action_order: 1 },
  { player_id: "preview-s3", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 100_000, action_order: 2 },
  { player_id: "preview-s4", entry_number: 1, street: "preflop", action_type: "call", action_amount: 100_000, action_order: 3 },
  { player_id: "preview-s1", entry_number: 1, street: "preflop", action_type: "raise", action_amount: 300_000, action_order: 4 },
  { player_id: "preview-s2", entry_number: 1, street: "preflop", action_type: "call", action_amount: 250_000, action_order: 5 },
  { player_id: "preview-s3", entry_number: 1, street: "preflop", action_type: "call", action_amount: 200_000, action_order: 6 },
  { player_id: "preview-s4", entry_number: 1, street: "preflop", action_type: "call", action_amount: 200_000, action_order: 7 },
  { player_id: "preview-s2", entry_number: 1, street: "flop", action_type: "check", action_amount: 0, action_order: 8 },
  { player_id: "preview-s3", entry_number: 1, street: "flop", action_type: "check", action_amount: 0, action_order: 9 },
  { player_id: "preview-s4", entry_number: 1, street: "flop", action_type: "bet", action_amount: 200_000, action_order: 10 },
  { player_id: "preview-s1", entry_number: 1, street: "flop", action_type: "call", action_amount: 200_000, action_order: 11 },
  { player_id: "preview-s2", entry_number: 1, street: "flop", action_type: "fold", action_amount: 0, action_order: 12 },
  { player_id: "preview-s3", entry_number: 1, street: "flop", action_type: "call", action_amount: 200_000, action_order: 13 },
];

type PreviewResult = {
  kind: "display" | "resettle";
  summary: string[];
  patch: HandEditPatch;
  expectedStacks?: ExpectedHandEndStack[];
};

export default function HandCorrectionPreview() {
  const [result, setResult] = useState<PreviewResult | null>(null);

  return (
    <main className="min-h-screen bg-[#090f0d] px-3 py-4 text-white sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-2xl border border-emerald-200/15 bg-[#0e1914] p-3 shadow-2xl shadow-black/20 sm:p-5">
          <header className="mb-4 border-b border-white/10 pb-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">Preview DEV only · no Supabase</p>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="font-serif text-xl font-bold text-white sm:text-2xl">Sửa hand &amp; đối chiếu stack cuối</h1>
              <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold text-amber-100">Hand #24 · BTN Ghế 1</span>
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-zinc-400">
              Sửa từng action theo thứ tự. Mỗi dòng cho biết stack trước, số cần theo hoặc raise tối thiểu; stack cuối chỉ là bằng chứng đối chiếu, không phải lệnh dời chip.
            </p>
          </header>

          <HandEditPanel
            board={["2d", "7c", "As"]}
            players={PLAYERS}
            actions={ACTIONS}
            buttonSeat={1}
            resettleEnabled
            onCancel={() => setResult(null)}
            onSave={(patch, _reason, summary) => setResult({ kind: "display", patch, summary })}
            onResettle={(_editedTarget, patch, _reason, summary, expectedStacks) => setResult({
              kind: "resettle",
              patch,
              summary,
              expectedStacks,
            })}
          />
        </section>

        <aside className="h-fit rounded-2xl border border-amber-200/15 bg-[#121713] p-4 xl:sticky xl:top-4">
          <h2 className="font-serif text-lg font-bold text-amber-100">Trình tự Floor</h2>
          <ol className="mt-3 space-y-3 text-xs leading-relaxed text-zinc-300">
            <li><span className="mr-2 font-mono text-amber-300">01</span>Sửa dòng đỏ trước: loại action và chip thêm vào.</li>
            <li><span className="mr-2 font-mono text-amber-300">02</span>Nhập stack cuối quan sát được của mọi ghế.</li>
            <li><span className="mr-2 font-mono text-amber-300">03</span>Thêm lý do, xem preview, rồi mới gửi server.</li>
          </ol>
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-[11px] font-semibold text-zinc-200">Receipt mô phỏng</p>
            {result ? (
              <div className="mt-2 space-y-2 text-[11px] text-zinc-300">
                <p className="font-semibold text-emerald-200">{result.kind === "resettle" ? "Đã tạo preview tính lại chip" : "Đã tạo preview lưu hiển thị"}</p>
                <p>{result.summary.length ? result.summary.join(" · ") : "Không có thay đổi để gửi."}</p>
                {result.expectedStacks && <p className="font-mono text-zinc-400">Đối chiếu {result.expectedStacks.length} stack cuối.</p>}
              </div>
            ) : <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">Sau khi sửa dữ liệu và ghi lý do, preview sẽ xuất hiện tại đây. Route này không gọi Edge hoặc DB.</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}
