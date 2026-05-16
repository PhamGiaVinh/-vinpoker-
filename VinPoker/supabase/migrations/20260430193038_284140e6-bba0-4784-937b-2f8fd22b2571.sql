-- Revoke super_admin tạm
DELETE FROM public.user_roles
 WHERE user_id = '6a9e15fd-ab97-443e-b376-5f294503fce4'::uuid
   AND role = 'super_admin';

-- Drop test artifacts
DROP FUNCTION IF EXISTS public.run_staking_e2e_test();
DROP TABLE IF EXISTS public._e2e_test_results;