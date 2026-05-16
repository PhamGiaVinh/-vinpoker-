-- Tạm cấp super_admin cho user 'vũ' để test multi-sig
INSERT INTO public.user_roles (user_id, role)
SELECT '6a9e15fd-ab97-443e-b376-5f294503fce4'::uuid, 'super_admin'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = '6a9e15fd-ab97-443e-b376-5f294503fce4'::uuid);