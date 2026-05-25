import { supabase } from "@/integrations/supabase/client";

type AdminFunctionName =
  | "score-predictions"
  | "sync-matches"
  | "audit-scoring"
  | "thesportsdb-fixture-test";

async function normalizeFunctionError(error: unknown): Promise<Error> {
  const response = (error as { context?: Response }).context;
  if (response) {
    try {
      const body = await response.clone().json();
      if (typeof body?.error === "string") return new Error(body.error);
      if (typeof body?.message === "string") return new Error(body.message);
    } catch {
      try {
        const text = await response.clone().text();
        if (text) return new Error(text);
      } catch {
        // Fall through to the original error message.
      }
    }
  }

  if (error instanceof Error) return error;
  return new Error("Edge Function retornou erro sem detalhes.");
}

export async function invokeAdminFunction<T>(
  functionName: AdminFunctionName,
  body?: Record<string, unknown>,
) {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return { data: null, error: sessionError };

  const token = data.session?.access_token;
  if (!token) {
    return {
      data: null,
      error: new Error("Sessão expirada. Faça login novamente."),
    };
  }

  const invokeOptions: {
    headers: Record<string, string>;
    body?: Record<string, unknown>;
  } = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) invokeOptions.body = body;

  const result = await supabase.functions.invoke<T>(functionName, invokeOptions);
  if (result.error) {
    return {
      data: null,
      error: await normalizeFunctionError(result.error),
    };
  }
  return result;
}
