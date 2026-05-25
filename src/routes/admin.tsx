import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  RefreshCw,
  Calculator,
  Shield,
  CheckCircle2,
  Circle,
  Trash2,
  SearchCheck,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AdminMatches } from "@/components/admin/AdminMatches";
import { AdminQualifiers } from "@/components/admin/AdminQualifiers";
import { TheSportsDbFixtureTest } from "@/components/admin/TheSportsDbFixtureTest";
import { invokeAdminFunction } from "@/lib/invoke-admin-function";
import { runClientScoringAudit, type ScoringAuditResult } from "@/lib/client-scoring-audit";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteUserAsAdmin, getUserEmails } from "@/lib/admin-users.functions";

const PROTECTED_OWNER_EMAILS = new Set(
  (import.meta.env.VITE_PROTECTED_OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function isProtectedOwnerEmail(email: string | null | undefined) {
  return PROTECTED_OWNER_EMAILS.has(email?.trim().toLowerCase() ?? "");
}

type PaymentMemberRow = {
  id: string;
  pool_id: string;
  user_id: string;
  has_paid: boolean;
  paid_at: string | null;
  display_name: string;
  email: string;
  phone: string;
};

type PaymentPoolRow = {
  id: string;
  name: string;
  members: PaymentMemberRow[];
};

const paymentMemberCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

function comparePaymentMembers(a: PaymentMemberRow, b: PaymentMemberRow) {
  const byName = paymentMemberCollator.compare(a.display_name, b.display_name);
  if (byName !== 0) return byName;

  const byEmail = paymentMemberCollator.compare(a.email, b.email);
  if (byEmail !== 0) return byEmail;

  return paymentMemberCollator.compare(a.user_id, b.user_id);
}

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
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<ScoringAuditResult | null>(null);

  const sync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await invokeAdminFunction<{
        ok?: boolean;
        error?: string;
        teams: number;
        matches: number;
        scoring?: {
          predictions: number;
          brackets: number;
          champions: number;
        };
      }>("sync-matches");
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falhou");

      toast.success(
        `Sincronizado: ${data.teams} times, ${data.matches} jogos. Pontos recalculados: ${data.scoring?.predictions ?? 0} palpites, ${data.scoring?.brackets ?? 0} chaves, ${data.scoring?.champions ?? 0} campeões.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar jogos.");
    } finally {
      setSyncing(false);
    }
  };

  const score = async () => {
    setScoring(true);
    try {
      const { data, error } = await invokeAdminFunction<{
        ok?: boolean;
        error?: string;
        predictions: number;
        brackets: number;
        champions: number;
      }>("score-predictions");

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falhou");

      toast.success(
        `Pontos calculados: ${data.predictions} palpites, ${data.brackets} chaves, ${data.champions} campeões.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível recalcular os pontos.");
    } finally {
      setScoring(false);
    }
  };

  const auditScoring = async () => {
    setAuditing(true);
    setAuditResult(null);

    try {
      const result = await runClientScoringAudit();
      setAuditResult(result);
      if (result.ok) {
        toast.success("Fórmulas alinhadas nas telas de pontuação.");
      } else {
        toast.warning(`Auditoria encontrou ${result.issues.length} divergência(s).`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível auditar a pontuação.");
    } finally {
      setAuditing(false);
    }
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
            <TheSportsDbFixtureTest />

            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="mb-1 text-lg font-bold">Sincronizar jogos da API</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Busca seleções, jogos e resultados oficiais da Copa do Mundo no TheSportsDB e
                recalcula a pontuação automaticamente.
              </p>
              <Button onClick={sync} disabled={syncing}>
                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Sincronizando e recalculando..." : "Sincronizar agora"}
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

            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="mb-1 text-lg font-bold">Auditar pontuação</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Compara banco, ranking, Tabela da Copa e detalhes do participante sem alterar dados.
              </p>
              <Button onClick={auditScoring} disabled={auditing} variant="outline">
                <SearchCheck className={`mr-2 h-4 w-4 ${auditing ? "animate-pulse" : ""}`} />
                {auditing ? "Auditando..." : "Auditar pontuação"}
              </Button>

              {auditResult && (
                <div className="mt-5 rounded-lg border border-border bg-background/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">
                        {auditResult.ok ? "Fórmulas alinhadas" : "Divergências reais encontradas"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Fonte: sessão admin. {auditResult.checked.pools} bolão(ões),{" "}
                        {auditResult.checked.matches} jogos, {auditResult.checked.predictions}{" "}
                        palpites, {auditResult.checked.bracketRows} linhas de chaveamento,{" "}
                        {auditResult.checked.rankingRows} linhas de ranking.
                      </p>
                      {auditResult.cache?.stale && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Cache antigo no banco: {auditResult.cache.total} linha(s) (
                          {auditResult.cache.predictions} palpites, {auditResult.cache.bracketRows}{" "}
                          chaveamento, {auditResult.cache.championRows} campeão). As telas de
                          pontuação não usam esse cache como fonte de verdade.
                        </p>
                      )}
                      {auditResult.repaired && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Correções aplicadas: {auditResult.repaired.total} linha(s) (
                          {auditResult.repaired.predictions} palpites,{" "}
                          {auditResult.repaired.bracketRows} chaveamento,{" "}
                          {auditResult.repaired.championRows} campeão).
                        </p>
                      )}
                    </div>
                    {auditResult.ok ? (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                    )}
                  </div>

                  {!auditResult.ok && (
                    <div className="mt-4 overflow-hidden rounded-md border border-border">
                      <div className="grid grid-cols-[1.2fr_1fr_.7fr_.7fr] gap-2 bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        <span>Participante</span>
                        <span>Área</span>
                        <span>Atual</span>
                        <span>Esperado</span>
                      </div>
                      <div className="max-h-80 divide-y divide-border overflow-y-auto">
                        {auditResult.issues.slice(0, 50).map((item, index) => (
                          <div
                            key={`${item.area}-${item.subject}-${index}`}
                            className="grid grid-cols-[1.2fr_1fr_.7fr_.7fr] gap-2 px-3 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-semibold">
                                {item.user_name ?? "Global"}
                              </div>
                              <div className="truncate text-muted-foreground">
                                {item.user_email ?? item.pool_name ?? "—"}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{item.area}</div>
                              <div className="truncate text-muted-foreground">{item.subject}</div>
                            </div>
                            <span className="font-mono tabular-nums">{item.actual ?? "—"}</span>
                            <span className="font-mono font-bold tabular-nums text-primary">
                              {item.expected ?? "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                      {auditResult.issues.length > 50 && (
                        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                          Mostrando 50 de {auditResult.issues.length} divergências.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
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
  const { user } = useAuth();
  const fetchEmails = useServerFn(getUserEmails);
  const deleteUser = useServerFn(deleteUserAsAdmin);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const { data: pools, isLoading } = useQuery<PaymentPoolRow[]>({
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
      let phoneMap = new Map<string, string>();
      if (userIds.length) {
        try {
          const res = await fetchEmails({ data: { userIds } });
          emailMap = new Map(Object.entries(res.emails));
          phoneMap = new Map(Object.entries(res.phones ?? {}));
        } catch (e) {
          console.error("Falha ao buscar contatos dos usuários", e);
        }
      }
      return (ps ?? []).map((p) => ({
        ...p,
        members: (members ?? [])
          .filter((m) => m.pool_id === p.id)
          .map((m) => ({
            ...m,
            display_name: profMap.get(m.user_id) ?? "Anônimo",
            email: emailMap.get(m.user_id) ?? "",
            phone: phoneMap.get(m.user_id) ?? "",
          }))
          .sort(comparePaymentMembers),
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

  const removeUser = async (targetUserId: string, displayName: string) => {
    setDeletingUserId(targetUserId);
    try {
      await deleteUser({ data: { userId: targetUserId } });
      toast.success(`Usuário ${displayName} excluído`);
      qc.invalidateQueries({ queryKey: ["admin-pools-payments"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir o usuário");
    } finally {
      setDeletingUserId(null);
    }
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
                  {pool.members.map((m) => {
                    const isProtectedOwner = isProtectedOwnerEmail(m.email);
                    return (
                      <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">{m.display_name}</span>
                            {isProtectedOwner && (
                              <span className="rounded border border-primary/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                                Owner
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {m.email || "—"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            Telefone: {m.phone || "—"}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
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
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={
                                  m.user_id === user?.id ||
                                  deletingUserId === m.user_id ||
                                  isProtectedOwner
                                }
                              >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                Excluir
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Esta ação exclui a conta de {m.display_name}
                                  {m.email ? ` (${m.email})` : ""} e remove seus dados do bolão. Não
                                  é possível desfazer.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => removeUser(m.user_id, m.display_name)}
                                >
                                  Excluir usuário
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
