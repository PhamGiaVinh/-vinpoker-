-- Migration: Approve/Reject Verification RPC
-- Replaces the Edge Function with a SECURITY DEFINER database function
-- so cashiers can approve/reject membership requests without needing
-- the Edge Function to be deployed separately.

CREATE OR REPLACE FUNCTION public.approve_verification(
  p_request_id UUID,
  p_action TEXT,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_req membership_verification_requests%ROWTYPE;
BEGIN
  -- Get authenticated user
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  -- Validate inputs
  IF p_request_id IS NULL OR p_action NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('error', 'Invalid input');
  END IF;
  IF p_action = 'reject' AND (p_rejection_reason IS NULL OR trim(p_rejection_reason) = '') THEN
    RETURN jsonb_build_object('error', 'rejection_reason required');
  END IF;

  -- Fetch the request
  SELECT * INTO v_req FROM public.membership_verification_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Not found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'Already reviewed');
  END IF;

  -- Check permission: must be cashier or owner of the club
  IF NOT public.is_club_cashier(v_uid, v_req.club_id) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  -- Execute action
  IF p_action = 'approve' THEN
    UPDATE public.membership_verification_requests
    SET status = 'approved', reviewed_by = v_uid, reviewed_at = now()
    WHERE id = p_request_id;

    UPDATE public.profiles
    SET verification_status = 'verified',
        verified_by_club_id = v_req.club_id,
        verified_at = now()
    WHERE user_id = v_req.player_user_id;

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_req.player_user_id,
      'verification_approved',
      'Tài khoản đã được xác minh',
      'CLB đã duyệt yêu cầu xác minh thành viên của bạn.',
      jsonb_build_object('club_id', v_req.club_id, 'request_id', p_request_id)
    );
  ELSE
    UPDATE public.membership_verification_requests
    SET status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), rejection_reason = p_rejection_reason
    WHERE id = p_request_id;

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_req.player_user_id,
      'verification_rejected',
      'Yêu cầu xác minh bị từ chối',
      p_rejection_reason,
      jsonb_build_object('club_id', v_req.club_id, 'request_id', p_request_id)
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
