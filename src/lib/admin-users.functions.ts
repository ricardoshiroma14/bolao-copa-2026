import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getUserEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userIds: string[] }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw new Error("Forbidden");

    const wanted = new Set(data.userIds);
    const emails: Record<string, string> = {};
    let page = 1;
    const perPage = 1000;
    // Paginate through users until all wanted ids are resolved or no more pages.
    while (wanted.size > 0) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      if (!list?.users?.length) break;
      for (const u of list.users) {
        if (wanted.has(u.id)) {
          emails[u.id] = u.email ?? "";
          wanted.delete(u.id);
        }
      }
      if (list.users.length < perPage) break;
      page += 1;
    }
    return { emails };
  });
