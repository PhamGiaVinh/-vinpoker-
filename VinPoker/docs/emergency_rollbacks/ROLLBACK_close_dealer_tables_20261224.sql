-- Rollback for 20261224000000_close_dealer_tables.sql
-- The frontend "Đóng bàn" button calls this RPC; dropping it makes the button error
-- (revert the FE PR too). No data touched by the drop.
DROP FUNCTION IF EXISTS public.close_dealer_tables(uuid, uuid, uuid[]);
NOTIFY pgrst, 'reload schema';
