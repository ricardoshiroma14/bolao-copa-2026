import { supabase } from "@/integrations/supabase/client";

/**
 * Looks up the first pool visible to the current session.
 * Pool membership is created only through the invite-code RPC.
 */
export async function resolveUserPoolId(_userId: string): Promise<string | null> {
  const { data: pool } = await supabase
    .from("pools")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return pool?.id ?? null;
}
