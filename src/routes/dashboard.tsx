import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    (async () => {
      const { data: pool } = await supabase
        .from("pools")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!pool) return;
      const { data: member } = await supabase
        .from("pool_members")
        .select("id")
        .eq("pool_id", pool.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!member) {
        await supabase.from("pool_members").insert({ pool_id: pool.id, user_id: user.id });
      }
      navigate({ to: "/pool/$id", params: { id: pool.id }, replace: true });
    })();
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen stadium-bg">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-center text-muted-foreground">Carregando bolão...</p>
      </main>
    </div>
  );
}
