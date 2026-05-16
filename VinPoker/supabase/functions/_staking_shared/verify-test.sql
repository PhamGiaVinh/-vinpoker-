-- ============================================================
-- VERIFY TEST RESULT — chạy sau khi test xong
-- THAY <DEAL_ID> bằng id deal đã test.
-- ============================================================

-- 1) Trạng thái cuối của deal (kỳ vọng: status='released', payouts đúng)
SELECT id, status, admin_review_status,
       buy_in_amount_vnd, percentage_sold, markup,
       asking_price_vnd, escrow_amount_vnd,
       result_prize_vnd, player_payout_vnd, backer_payout_vnd, platform_fee_vnd,
       admin_override_approved, admin_override_reason
FROM public.staking_deals
WHERE id = '<DEAL_ID>';

-- 2) Audit trail đầy đủ — kỳ vọng (theo thứ tự):
--    created -> reviewed -> committed -> funded -> result_entered ->
--    release_requested -> release_cosigned -> released
SELECT created_at, action, performed_by, old_status, new_status, metadata
FROM public.staking_audit_logs
WHERE deal_id = '<DEAL_ID>'
ORDER BY created_at;

-- 3) Ledger — kỳ vọng 4 dòng: fund_lock, payout_player, payout_backer, platform_fee
--    Tổng outflow (player+backer+fee) phải = result_prize_vnd
SELECT created_at, transaction_type, amount_vnd, bank_tx_id, performed_by_admin_id
FROM public.escrow_transactions
WHERE deal_id = '<DEAL_ID>'
ORDER BY created_at;

-- 4) Reconciliation: tổng payout = prize? (phải bằng 0)
SELECT
  d.result_prize_vnd                        AS prize,
  d.player_payout_vnd + d.backer_payout_vnd + d.platform_fee_vnd AS total_payouts,
  d.result_prize_vnd
    - (d.player_payout_vnd + d.backer_payout_vnd + d.platform_fee_vnd) AS diff
FROM public.staking_deals d
WHERE d.id = '<DEAL_ID>';

-- 5) Release request — kỳ vọng status='executed', requester ≠ cosigner
SELECT id, status, requested_by_admin_id, cosigned_by_admin_id,
       (requested_by_admin_id = cosigned_by_admin_id) AS BAD_SAME_ADMIN,
       cosigned_at, executed_at
FROM public.staking_release_requests
WHERE deal_id = '<DEAL_ID>';
