// Optional contract from pending-migrations/20260917000000_bankroll_soft_delete_restore.sql.
// These declarations do not assert deployment. Missing RPCs and unexpected results fail closed.
export type BankrollArchiveRpc = (name: "soft_delete_bankroll_entry" | "soft_delete_all_bankroll_entries" | "restore_bankroll_entry",
  args: { p_entry_id?: string; p_reason?: string }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export async function archiveBankrollEntries(rpc: BankrollArchiveRpc, entryId?: string): Promise<number> {
  const { data, error } = await rpc(entryId ? "soft_delete_bankroll_entry" : "soft_delete_all_bankroll_entries",
    entryId ? { p_entry_id: entryId, p_reason: "user_requested" } : { p_reason: "user_requested_bulk" });
  if (error) throw new Error(error.message);
  if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 0 || (entryId && data !== 1)) {
    throw new Error("Không xác nhận được số bản ghi đã lưu trữ. Hãy tải lại dữ liệu trước khi thử tiếp.");
  }
  return data;
}

export async function restoreBankrollEntry(rpc: BankrollArchiveRpc, entryId: string): Promise<boolean> {
  const { data, error } = await rpc("restore_bankroll_entry", { p_entry_id: entryId });
  if (error) throw new Error(error.message);
  if (typeof data !== "boolean") throw new Error("Không xác nhận được kết quả khôi phục. Hãy tải lại dữ liệu.");
  return data;
}
