import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Calculator, Shield, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AdminMatches } from "@/components/admin/AdminMatches";
import { AdminQualifiers } from "@/components/admin/AdminQualifiers";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getUserEmails } from "@/lib/admin-users.functions";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: isAdmin, isLoading: roleLoading } = useQuery({
    queryKey: ["isAdmin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });

  const [syncing, setSyncing] = useState(false);
  const [scoring, setScoring] = useState(false);

  const sync = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("sync-matches");
    setSyncing(false);
    if (error) return toast.error(error.message);
    if (!data?.ok) return toast.error(data?.error ?? "Falhou");
    toast.success(`Sincronizado: ${data.teams} times, ${data.matches} jogos`);
  };

  const score = async () => {
    setScoring(true);
    const { data, error } = await supabase.functions.invoke("score-predictions");
    setScoring(false);
    if (error) return toast.error(error.message);
    if (!data?.ok) return toast.error(data?.error ?? "Falhou");
    toast.success(`Pontos calculados: ${data.predictions} palpites`);
  };

  if (roleLoading)
    return (
      <div className="min-h-screen stadium-bg">
        <Header />
        <div className="p-10 text-center text-muted-foreground">Carregando...</div>
      </div>
    );
  if (!isAdmin) {
    return (
      <div className="min-h-screen stadium-bg">
        <Header />
        <main className="mx-auto max-w-md px-4 py-20 text-center">
          <Shield className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-bold">Acesso restrito</h1>
          <p className="text-sm text-muted-foreground">Esta área é apenas para administradores.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen stadium-bg">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="mb-2 text-3xl font-black uppercase tracking-tight">Painel admin</h1>
        <p className="mb-8 text-sm text-muted-foreground">Ferramentas de manutenção do bolão.</p>

        <Tabs defaultValue="matches" className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-auto">
            <TabsTrigger value="matches">Jogos</TabsTrigger>
            <TabsTrigger value="qualifiers">Classificados</TabsTrigger>
            <TabsTrigger value="sync">Sincronização</TabsTrigger>
            <TabsTrigger value="payments">Pagamentos</TabsTrigger>
          </TabsList>

          <TabsContent value="matches" className="mt-4">
            <AdminMatches />
          </TabsContent>

          <TabsContent value="qualifiers" className="mt-4">
            <AdminQualifiers />
          </TabsContent>

          <TabsContent value="sync" className="mt-4 space-y-4">
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="mb-1 text-lg font-bold">Sincronizar jogos da API</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Busca seleções, jogos e resultados oficiais da Copa do Mundo na football-data.org.
                Requer a chave <code className="rounded bg-secondary px-1">FOOTBALL_API_KEY</code>.
              </p>
              <Button onClick={sync} disabled={syncing}>
                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Sincronizando..." : "Sincronizar agora"}
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="mb-1 text-lg font-bold">Recalcular pontuação</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Roda o cálculo de pontos para todos os palpites de jogos finalizados, chaveamento e
                campeão.
              </p>
              <Button onClick={score} disabled={scoring} variant="secondary">
                <Calculator className={`mr-2 h-4 w-4 ${scoring ? "animate-spin" : ""}`} />
                {scoring ? "Calculando..." : "Recalcular pontos"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="payments" className="mt-4">
            <PaymentsAdmin />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function PaymentsAdmin() {
  const qc = useQueryClient();
  const fetchEmails = useServerFn(getUserEmails);
  type PaymentMember = {
    id: string;
    pool_id: string;
    user_id: string;
    has_paid: boolean;
    paid_at: string | null;
    display_name: string;
    email: string;
  };

  const { data: pools, isLoading } = useQuery({
    queryKey: ["admin-pools-payments"],
    queryFn: async () => {
      const { data: ps, error } = await supabase
        .from("pools")
        .select("id, name")
        .order("created_at");
      if (error) throw error;
      const ids = (ps ?? []).map((p) => p.id);
      if (!ids.length) return [];
      const { data: members } = await supabase
        .from("pool_members")
        .select("id, pool_id, user_id, has_paid, paid_at")
        .in("pool_id", ids);
      const userIds = Array.from(new Set((members ?? []).map((m) => m.user_id)));
      const profsRes = userIds.length
        ? await supabase.from("profiles").select("id, display_name").in("id", userIds)
        : { data: [] as { id: string; display_name: string }[] };
      const profMap = new Map((profsRes.data ?? []).map((p) => [p.id, p.display_name]));
      let emailMap = new Map<string, string>();
      if (userIds.length) {
        try {
          const res = await fetchEmails({ data: { userIds } });
          emailMap = new Map(Object.entries(res.emails));
        } catch (e) {
          console.error("Falha ao buscar emails", e);
        }
      }
      return (ps ?? []).map((p) => ({
        ...p,
        members: (members ?? [])
          .filter((m) => m.pool_id === p.id)
          .map(
            (m): PaymentMember => ({
              ...m,
              display_name: profMap.get(m.user_id) ?? "Anônimo",
              email: emailMap.get(m.user_id) ?? "",
            }),
          ),
      }));
    },
  });

  const toggle = async (memberId: string, current: boolean) => {
    const { error } = await supabase
      .from("pool_members")
      .update({ has_paid: !current, paid_at: !current ? new Date().toISOString() : null })
      .eq("id", memberId);
    if (error) return toast.error(error.message);
    toast.success(!current ? "Pagamento confirmado" : "Pagamento removido");
    qc.invalidateQueries({ queryKey: ["admin-pools-payments"] });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="mb-1 text-lg font-bold">Confirmação de pagamentos</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Apenas participantes com pagamento confirmado concorrem à premiação.
      </p>
      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {pools?.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum bolão cadastrado.</p>
      )}
      <div className="space-y-6">
        {pools?.map((pool) => {
          const paidCount = pool.members.filter((m) => m.has_paid).length;
          return (
            <div key={pool.id}>
              <div className="mb-2 flex items-baseline justify-between">
                <h4 className="font-bold">{pool.name}</h4>
                <span className="text-xs text-muted-foreground">
                  {paidCount}/{pool.members.length} pagos
                </span>
              </div>
              {pool.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem membros.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {pool.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{m.display_name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.email || "—"}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={m.has_paid ? "default" : "outline"}
                        onClick={() => toggle(m.id, m.has_paid)}
                      >
                        {m.has_paid ? (
                          <>
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            Pago
                          </>
                        ) : (
                          <>
                            <Circle className="mr-1.5 h-3.5 w-3.5" />
                            Marcar como pago
                          </>
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
