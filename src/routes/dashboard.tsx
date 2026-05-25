import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [status, setStatus] = useState("Carregando bolão...");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    (async () => {
      const { data: pool, error } = await supabase
        .from("pools")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        setStatus("Não foi possível carregar seus bolões.");
        return;
      }
      if (!pool) {
        setStatus("Você ainda não participa de nenhum bolão.");
        return;
      }
      navigate({ to: "/pool/$id", params: { id: pool.id }, replace: true });
    })();
  }, [user, loading, navigate]);

  const joinByInviteCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const code = inviteCode.trim();
    if (!code) {
      toast.error("Informe o código de convite");
      return;
    }

    setJoining(true);
    const { data: poolId, error } = await supabase.rpc("join_pool_by_invite_code", {
      _invite_code: code,
    });
    setJoining(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    if (poolId) {
      toast.success("Entrada confirmada");
      navigate({ to: "/pool/$id", params: { id: poolId }, replace: true });
    }
  };

  return (
    <div className="min-h-screen stadium-bg">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <form
          className="mx-auto max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl"
          onSubmit={joinByInviteCode}
        >
          <h1 className="text-xl font-black uppercase tracking-tight">Entrar no bolão</h1>
          <p className="mt-2 text-sm text-muted-foreground">{status}</p>
          <div className="mt-5 space-y-2">
            <Label htmlFor="invite-code">Código de convite</Label>
            <Input
              id="invite-code"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="Ex.: ABC123"
              autoComplete="off"
            />
          </div>
          <Button type="submit" className="mt-4 w-full" disabled={joining || !user}>
            {joining ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </main>
    </div>
  );
}
