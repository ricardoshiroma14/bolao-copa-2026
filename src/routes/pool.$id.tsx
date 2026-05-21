import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  Calendar,
  BarChart3,
  Settings as SettingsIcon,
  Crown,
  ListChecks,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
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

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: pool, isLoading } = useQuery({
    queryKey: ["pool", id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("pools").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [tab, setTab] = useState("matches");

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
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Bolão
              </div>
              <h1 className="text-3xl font-black uppercase tracking-tight">{pool.name}</h1>
              {pool.description && (
                <p className="mt-1 text-sm text-muted-foreground">{pool.description}</p>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(pool.invite_code);
                toast.success("Código copiado!");
              }}
              className="font-mono"
            >
              <Copy className="mr-2 h-4 w-4" />
              {pool.invite_code}
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TooltipProvider delayDuration={150}>
            <TabsList className="grid w-full grid-cols-6 h-auto">
              {[
                {
                  value: "matches",
                  label: "Resultado Jogos",
                  shortLabel: "Tabela da Copa",
                  icon: Calendar,
                },
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
          <TabsContent value="matches" className="mt-6">
            <MatchesTab poolId={id} />
          </TabsContent>
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
