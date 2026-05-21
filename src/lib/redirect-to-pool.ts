import { supabase } from "@/integrations/supabase/client";

/**
 * Looks up the first available pool, ensures the user is a member,
 * and returns its id. Returns null if no pool exists.
 */
export async function resolveUserPoolId(userId: string): Promise<string | null> {
  const { data: pool } = await supabase
    .from("pools")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pool) return null;

  const { data: member } = await supabase
    .from("pool_members")
    .select("id")
    .eq("pool_id", pool.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) {
    await supabase.from("pool_members").insert({ pool_id: pool.id, user_id: userId });
  }
  return pool.id;
}
