import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { computeQualifiers, type MatchLite, type TeamLite } from "@/lib/group-standings";
import { THIRD_PLACE_COMBINATION_NUMBERS } from "@/lib/wc2026-thirds-combination-numbers";
import { THIRD_PLACE_COMBINATIONS } from "@/lib/wc2026-thirds-combinations";
import { R32 } from "@/lib/wc2026-bracket";

type TeamRow = TeamLite & { flag_url: string | null };

type R32MatchRow = {
  id: string;
  external_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
};

const MATCH_NUM_RE = /m(\d{2,3})\b/i;

function extractR32Num(external_id: string | null): number | null {
  if (!external_id) return null;
  const m = external_id.match(MATCH_NUM_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 73 && n <= 88 ? n : null;
}

export function AdminQualifiers() {
  const qc = useQueryClient();
  const [applying, setApplying] = useState(false);

  const { data: teams } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id,name,code,group_name,flag_url")
        .order("name");
      if (error) throw error;
      return data as TeamRow[];
    },
  });

  const { data: matches } = useQuery({
    queryKey: ["admin-qualifier-matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("id,stage,group_name,home_team_id,away_team_id,home_score,away_score,status")
        .eq("stage", "group");
      if (error) throw error;
      return data as (MatchLite & {
        home_score: number | null;
        away_score: number | null;
        status: string;
      })[];
    },
  });

  const { data: r32Matches } = useQuery({
    queryKey: ["admin-r32-matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("id,external_id,home_team_id,away_team_id")
        .eq("stage", "round_of_32");
      if (error) throw error;
      return data as R32MatchRow[];
    },
  });

  const computed = useMemo(() => {
    if (!teams || !matches) return null;
    const finished = matches.filter(
      (m) => m.status === "finished" && m.home_score !== null && m.away_score !== null,
    );
    const preds = finished.map((m) => ({
      match_id: m.id,
      home_score: m.home_score!,
      away_score: m.away_score!,
    }));
    const totalGroupGames = matches.length;
    const allFinished = finished.length === totalGroupGames && totalGroupGames > 0;
    const { qualified } = computeQualifiers(teams, matches, preds);
    const thirds = qualified.filter((q) => q.position === 3);
    const comboKey =
      thirds.length === 8
        ? thirds
            .map((t) => t.group)
            .sort()
            .join("")
        : null;
    const comboNumber = comboKey ? THIRD_PLACE_COMBINATION_NUMBERS[comboKey] : null;
    const thirdsMap = comboKey ? THIRD_PLACE_COMBINATIONS[comboKey] : null;
    return {
      finished,
      preds,
      totalGroupGames,
      allFinished,
      qualified,
      thirds,
      comboKey,
      comboNumber,
      thirdsMap,
    };
  }, [teams, matches]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!computed || !r32Matches || !teams) throw new Error("Dados não carregados");
      const { qualified, thirdsMap, allFinished } = computed;
      if (!allFinished) throw new Error("Faltam jogos da fase de grupos para encerrar.");
      if (!thirdsMap) throw new Error("Combinação de 3º colocados inválida.");

      const winnerByGroup = new Map<string, string>();
      const runnerByGroup = new Map<string, string>();
      const thirdByGroup = new Map<string, string>();
      for (const q of qualified) {
        if (q.position === 1) winnerByGroup.set(q.group, q.team.id);
        else if (q.position === 2) runnerByGroup.set(q.group, q.team.id);
        else if (q.position === 3) thirdByGroup.set(q.group, q.team.id);
      }

      const resolveSlot = (matchNum: number, side: "a" | "b"): string | null => {
        const spec = R32.find((m) => m.match === matchNum);
        if (!spec) return null;
        const s = side === "a" ? spec.a : spec.b;
        if (s.kind === "winner") return winnerByGroup.get(s.group) ?? null;
        if (s.kind === "runnerUp") return runnerByGroup.get(s.group) ?? null;
        if (s.kind === "third") {
          const grp = thirdsMap[String(matchNum) as unknown as number];
          return grp ? (thirdByGroup.get(grp) ?? null) : null;
        }
        return null;
      };

      let updated = 0;
      for (const row of r32Matches) {
        const num = extractR32Num(row.external_id);
        if (!num) continue;
        const home = resolveSlot(num, "a");
        const away = resolveSlot(num, "b");
        if (!home || !away) continue;
        if (row.home_team_id === home && row.away_team_id === away) continue;
        const { error } = await supabase
          .from("matches")
          .update({ home_team_id: home, away_team_id: away })
          .eq("id", row.id);
        if (error) throw error;
        updated += 1;
      }
      return updated;
    },
    onMutate: () => setApplying(true),
    onSettled: () => setApplying(false),
    onSuccess: (count) => {
      toast.success(
        count > 0
          ? `Rodada de 32 atualizada (${count} jogos).`
          : "Rodada de 32 já estava alinhada.",
      );
      qc.invalidateQueries({ queryKey: ["admin-matches"] });
      qc.invalidateQueries({ queryKey: ["admin-r32-matches"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!teams || !matches || !computed) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  const { qualified, totalGroupGames, finished, allFinished, comboNumber, thirdsMap } = computed;

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="mb-3 flex items-center gap-2 text-primary">
        <Trophy className="h-5 w-5" />
        <h3 className="text-lg font-black uppercase tracking-tight">
          Classificados ao mata-mata (oficial)
        </h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Calculado a partir dos resultados oficiais já encerrados na tabela de jogos.
        {!allFinished && (
          <span className="ml-1 text-foreground">
            Faltam {totalGroupGames - finished.length} jogos da fase de grupos para encerrar.
          </span>
        )}{" "}
        Os confrontos dos 3º colocados seguem as 495 combinações oficiais da FIFA —{" "}
        <a
          href="https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          ver tabela na Wikipedia
        </a>
        .
        {comboNumber && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-bold text-primary">
            Combinação Nº {comboNumber} de 495
          </span>
        )}
      </p>

      {allFinished && thirdsMap && (
        <div className="mb-4">
          <Button
            size="sm"
            onClick={() => applyMutation.mutate()}
            disabled={applying || applyMutation.isPending}
          >
            <Wand2 className="mr-1 h-4 w-4" />
            {applying ? "Aplicando..." : "Aplicar classificados à Rodada de 32"}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Atualiza os jogos M73–M88 com os times corretos (1º/2º/3º) conforme o bracket oficial.
          </p>
        </div>
      )}

      {qualified.length === 0 ? (
        <div className="text-center text-xs text-muted-foreground">
          Nenhum jogo encerrado ainda.
        </div>
      ) : (
        <div className="space-y-5">
          {([1, 2, 3] as const).map((pos) => {
            const items = qualified.filter((q) => q.position === pos);
            items.sort((a, b) => (a.group || "").localeCompare(b.group || ""));
            if (items.length === 0) return null;
            const title =
              pos === 1 ? "1º colocados" : pos === 2 ? "2º colocados" : "Melhores 3º colocados";
            return (
              <div key={pos}>
                <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-primary">
                  {title}
                </h4>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {items.map((q) => {
                    const t = teams.find((tt) => tt.id === q.team.id);
                    return (
                      <div
                        key={`${q.team.id}-${q.position}`}
                        className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
                      >
                        <span className="inline-flex items-center gap-2 min-w-0">
                          {t?.flag_url && (
                            <img
                              src={t.flag_url}
                              alt=""
                              className="h-3.5 w-5 object-cover rounded-sm shrink-0"
                            />
                          )}
                          <span className="font-medium truncate">{q.team.name}</span>
                        </span>
                        <span className="ml-2 text-xs font-bold uppercase text-muted-foreground">
                          {`${pos}º ${q.group}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
