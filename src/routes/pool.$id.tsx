import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  BarChart3,
  Settings as SettingsIcon,
  Crown,
  ListChecks,
  Wallet,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { useEffectiveAdmin } from "@/lib/admin-view";
import { supabase } from "@/integrations/supabase/client";
import { isBeforeMatchesRelease } from "@/lib/release-windows";
import { MatchesTab } from "@/components/pool/MatchesTab";
import { RankingTab } from "@/components/pool/RankingTab";
import { BracketTab } from "@/components/pool/BracketTab";
import { RulesTab } from "@/components/pool/RulesTab";
import { PredictionsTab } from "@/components/pool/PredictionsTab";
import { PaymentTab } from "@/components/pool/PaymentTab";

export const Route = createFileRoute("/pool/$id")({
  component: PoolPage,
});

function PoolPage() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const { data: pool, isLoading } = useQuery({
    queryKey: ["pool", id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("pools").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: participantCount = 0 } = useQuery({
    queryKey: ["pool-participant-count", id],
    enabled: !!user,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("pool_members")
        .select("*", { count: "exact", head: true })
        .eq("pool_id", id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
  });

  const [tab, setTab] = useState("predictions");
  const effectiveIsAdmin = useEffectiveAdmin(isAdmin);
  const showMatchesTab = !isBeforeMatchesRelease(now) || effectiveIsAdmin;

  useEffect(() => {
    if (!showMatchesTab && tab === "matches") setTab("predictions");
  }, [showMatchesTab, tab]);

  if (isLoading)
    return (
      <div className="min-h-screen stadium-bg">
        <Header />
        <div className="p-10 text-center text-muted-foreground">Carregando...</div>
      </div>
    );
  if (!pool)
    return (
      <div className="min-h-screen stadium-bg">
        <Header />
        <div className="p-10 text-center">Bolão não encontrado.</div>
      </div>
    );

  return (
    <div className="min-h-screen stadium-bg">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 rounded-xl border border-border bg-card p-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Bolão</div>
            <h1 className="text-3xl font-black uppercase tracking-tight">{pool.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              # Participantes: {participantCount}
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TooltipProvider delayDuration={150}>
            <TabsList
              className={`grid w-full h-auto ${showMatchesTab ? "grid-cols-6" : "grid-cols-5"}`}
            >
              {[
                ...(showMatchesTab
                  ? [
                      {
                        value: "matches",
                        label: "Resultado Jogos",
                        shortLabel: "Tabela da Copa",
                        icon: Calendar,
                      },
                    ]
                  : []),
                {
                  value: "predictions",
                  label: "Palpites Fase Grupos",
                  shortLabel: "Grupos",
                  icon: ListChecks,
                },
                {
                  value: "bracket",
                  label: "Palpites Fase Chaveamento",
                  shortLabel: "Chave",
                  icon: Crown,
                },
                { value: "ranking", label: "Ranking", icon: BarChart3 },
                {
                  value: "payment",
                  label: "Pagamento do Bolão",
                  shortLabel: "Pagar",
                  icon: Wallet,
                },
                {
                  value: "rules",
                  label: "Regras do Bolão",
                  shortLabel: "Regras",
                  icon: SettingsIcon,
                },
              ].map(({ value, label, shortLabel, icon: Icon }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <TabsTrigger value={value} aria-label={label} className="px-2 sm:px-3">
                      <Icon className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">{shortLabel ?? label}</span>
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="sm:hidden">
                    {label}
                  </TooltipContent>
                </Tooltip>
              ))}
            </TabsList>
          </TooltipProvider>
          {showMatchesTab && (
            <TabsContent value="matches" className="mt-6">
              <MatchesTab poolId={id} />
            </TabsContent>
          )}
          <TabsContent value="predictions" className="mt-6">
            <PredictionsTab onAdvanceToBracket={() => setTab("bracket")} />
          </TabsContent>
          <TabsContent value="bracket" className="mt-6">
            <BracketTab poolId={id} />
          </TabsContent>
          <TabsContent value="ranking" className="mt-6">
            <RankingTab poolId={id} />
          </TabsContent>
          <TabsContent value="payment" className="mt-6">
            <PaymentTab />
          </TabsContent>
          <TabsContent value="rules" className="mt-6">
            <RulesTab pool={pool} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
