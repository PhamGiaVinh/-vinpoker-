import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readMockExpenses, mockRecordExpense, summarize } from "@/lib/clubExpenses/mockExpenses";
import type {
  ClubExpenseRow,
  ClubExpenseSource,
  ClubExpensesSummary,
  ExpenseCategory,
  ExpensePaymentSource,
  ExpensePaymentStatus,
} from "@/lib/clubExpenses/types";

function mapRow(row: any): ClubExpenseRow {
  return {
    id: row.id,
    clubId: row.club_id,
    category: row.category,
    amountVnd: Number(row.amount_vnd ?? 0),
    description: row.description ?? null,
    incurredAt: row.incurred_at,
    tournamentId: row.tournament_id ?? null,
    seriesId: row.series_id ?? null,
    paymentStatus: row.payment_status,
    paymentSource: row.payment_source ?? null,
    attachmentUrl: row.attachment_url ?? null,
    adjustsId: row.adjusts_id ?? null,
    enteredBy: row.entered_by ?? null,
    createdAt: row.created_at ?? null,
  };
}

function parseSummary(data: any, clubId: string, from: string, to: string): ClubExpensesSummary {
  const rows = (data?.rows ?? []).map(mapRow);
  return {
    clubId,
    from,
    to,
    rows,
    totalVnd: Number(data?.total_vnd ?? 0),
    paidVnd: Number(data?.paid_vnd ?? 0),
    unpaidVnd: Number(data?.unpaid_vnd ?? 0),
    byCategory: data?.by_category ?? {},
  };
}

export function useClubExpenses(source: ClubExpenseSource, clubId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["clubExpenses", "summary", source, clubId ?? "", from, to],
    enabled: !!clubId,
    staleTime: 30_000,
    queryFn: async (): Promise<ClubExpensesSummary> => {
      if (!clubId) return summarize("", from, to, []);
      if (source === "mock") return readMockExpenses(clubId, from, to);
      const { data, error } = await (supabase.rpc as any)("get_club_expenses", {
        p_club_id: clubId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return parseSummary(data, clubId, from, to);
    },
  });
}

export function useRecordClubExpense(source: ClubExpenseSource, clubId: string | null, from: string, to: string) {
  const queryClient = useQueryClient();
  const queryKey = ["clubExpenses", "summary", source, clubId ?? "", from, to];

  return useMutation({
    mutationFn: async (input: {
      category: ExpenseCategory;
      amountVnd: number;
      incurredAt: string;
      description?: string;
      paymentStatus: ExpensePaymentStatus;
      paymentSource?: ExpensePaymentSource | null;
    }) => {
      if (!clubId) throw new Error("Chưa chọn CLB.");
      if (source === "mock") return mockRecordExpense({ clubId, ...input });
      const { data, error } = await (supabase.rpc as any)("record_club_expense", {
        p_club_id: clubId,
        p_category: input.category,
        p_amount_vnd: input.amountVnd,
        p_incurred_at: input.incurredAt,
        p_description: input.description || null,
        p_payment_status: input.paymentStatus,
        p_payment_source: input.paymentSource ?? null,
        p_tournament_id: null,
        p_series_id: null,
        p_attachment_url: null,
        p_adjusts_id: null,
        p_idempotency_key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.detail ?? data.error);
      return data;
    },
    onSuccess: () => {
      toast.success(source === "mock" ? "Đã ghi dòng preview." : "Đã ghi chi phí.");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: any) => toast.error(error?.message ?? "Không thể ghi chi phí."),
  });
}
