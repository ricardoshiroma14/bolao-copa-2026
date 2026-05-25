import { createClient } from "npm:@supabase/supabase-js@2";

export class AdminAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new AdminAuthError(500, `${name} não configurada`);
  return value;
}

function getAuthKey(): string {
  const value = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!value) throw new AdminAuthError(500, "SUPABASE_PUBLISHABLE_KEY não configurada");
  return value;
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new AdminAuthError(401, "Unauthorized: Bearer token obrigatório");
  }
  return token;
}

export async function requireAdmin(req: Request): Promise<string> {
  const token = getBearerToken(req);

  // Allow service-role bypass (used by pg_cron scheduled invocations).
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return "service-role";

  const supabase = createClient(getRequiredEnv("SUPABASE_URL"), getAuthKey(), {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) throw new AdminAuthError(401, "Unauthorized: token inválido");

  const { data: role, error: roleError } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError) throw new AdminAuthError(500, "Falha ao validar permissões");
  if (!role) throw new AdminAuthError(403, "Forbidden: admin obrigatório");
  return user.id;
}
