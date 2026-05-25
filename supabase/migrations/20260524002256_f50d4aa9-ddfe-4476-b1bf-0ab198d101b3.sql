REVOKE EXECUTE ON FUNCTION public.join_pool_by_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_pool_by_invite_code(text) TO authenticated;