import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ROUND_OF_32_RELEASE_FALLBACK_DISABLED,
  ROUND_OF_32_RELEASE_FALLBACK_ENABLED,
} from "@/lib/round-of-32-release";

function isMissingReleaseColumnError(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "PGRST204" || (error?.message?.includes("round_of_32_points_enabled") ?? false)
  );
}

export const setRoundOf32PointsRelease = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enabled: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw new Error("Forbidden");

    const { data: pools, error: poolsError } = await supabaseAdmin.from("pools").select("id");
    if (poolsError) throw poolsError;

    const poolIds = (pools ?? []).map((pool) => pool.id);
    if (poolIds.length === 0) return { ok: true, enabled: data.enabled, count: 0 };

    const fallbackValue = data.enabled
      ? ROUND_OF_32_RELEASE_FALLBACK_ENABLED
      : ROUND_OF_32_RELEASE_FALLBACK_DISABLED;

    const { error: releaseColumnError } = await supabaseAdmin
      .from("pools")
      .update({ round_of_32_points_enabled: data.enabled })
      .in("id", poolIds);

    if (releaseColumnError && !isMissingReleaseColumnError(releaseColumnError)) {
      throw releaseColumnError;
    }

    const { error: fallbackError } = await supabaseAdmin
      .from("pools")
      .update({ bonus_round_of_32_wrong: fallbackValue })
      .in("id", poolIds);
    if (fallbackError) throw fallbackError;

    return {
      ok: true,
      enabled: data.enabled,
      count: poolIds.length,
      storage: releaseColumnError ? "fallback" : "column",
    };
  });
