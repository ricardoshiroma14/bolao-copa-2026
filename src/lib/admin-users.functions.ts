import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PROTECTED_OWNER_EMAILS = new Set(
  (process.env.PROTECTED_OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

function metadataPhone(metadata: Record<string, unknown> | null | undefined) {
  const phone =
    metadata?.phone ?? metadata?.phone_number ?? metadata?.telefone ?? metadata?.whatsapp;
  return typeof phone === "string" ? phone.trim() : "";
}

function normalizeEmail(email: string | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

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
    const phones: Record<string, string> = {};
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
          phones[u.id] = u.phone?.trim() || metadataPhone(u.user_metadata);
          wanted.delete(u.id);
        }
      }
      if (list.users.length < perPage) break;
      page += 1;
    }
    return { emails, phones };
  });

export const deleteUserAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const targetUserId = data.userId?.trim();
    if (!targetUserId) throw new Error("Usuário inválido");
    if (targetUserId === userId) throw new Error("Você não pode excluir sua própria conta");

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw new Error("Forbidden");

    const { data: targetAdmin } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", targetUserId)
      .eq("role", "admin")
      .maybeSingle();
    if (targetAdmin) throw new Error("Não é possível excluir outro admin por esta tela");

    const { data: ownedPool } = await supabaseAdmin
      .from("pools")
      .select("id")
      .eq("owner_id", targetUserId)
      .limit(1)
      .maybeSingle();
    if (ownedPool) throw new Error("Não é possível excluir o dono de um bolão por esta tela");

    const { data: targetUser, error: targetError } =
      await supabaseAdmin.auth.admin.getUserById(targetUserId);
    if (targetError) throw targetError;
    if (PROTECTED_OWNER_EMAILS.has(normalizeEmail(targetUser.user.email))) {
      throw new Error("Não é possível excluir um owner por esta tela");
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
    if (error) throw error;
    return { ok: true };
  });
