-- EMERGENCY ROLLBACK — dealer_login_codes (migration 20261013000000)
--
-- Purely additive: one NEW service_role-only table for one-time dealer-app login codes. Touches no
-- existing object/data. The /code bot handler + dealer-code-login edge fn degrade safely if absent
-- (issue/redeem just fail with "mã không hợp lệ"). Rollback = drop it.

DROP TABLE IF EXISTS public.dealer_login_codes;
