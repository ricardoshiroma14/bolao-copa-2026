import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Lock,
  Clock,
  CheckCircle2,
  Crown,
  Trophy,
  MapPin,
  Calendar,
  LayoutGrid,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  computeQualifiers,
  type MatchLite,
  type PredLite,
  type Row as StandingRow,
  type TeamLite,
} from "@/lib/group-standings";
import {
  R32,
  R16,
  QF,
  SF,
  FINAL,
  THIRD_PLACE_MATCH,
  type BracketMatch,
  type SlotSpec,
} from "@/lib/wc2026-bracket";
import { lookupThirdsAssignment } from "@/lib/wc2026-thirds-combinations";
import { BRACKET_SCHEDULE } from "@/lib/wc2026-bracket-schedule";

const BRACKET_MATCHES_BY_STAGE: Record<string, number[]> = {
  round_of_32: R32.map((m) => m.match),
  round_of_16: R16.map((m) => m.match),
  quarter: QF.map((m) => m.match),
  semi: SF.map((m) => m.match),
  third_place: [THIRD_PLACE_MATCH],
  final: [FINAL.match],
};

function matchNumberFromRealMatch(match: {
  external_id: string | null;
  stage: string;
  kickoff_at: string;
}): number | null {
  const fromExternalId = match.external_id?.match(/\b(?:M|match[-_ ]?)?(\d{2,3})\b/i);
  if (fromExternalId) {
    const num = Number(fromExternalId[1]);
    if (num >= 73 && num <= FINAL.match) return num;
  }
  const stageMatches = BRACKET_MATCHES_BY_STAGE[match.stage] ?? [];
  if (stageMatches.length === 1) return stageMatches[0];
  const kickoffMs = new Date(match.kickoff_at).getTime();
  const byKickoff = stageMatches.find((num) => {
    const scheduled = BRACKET_SCHEDULE[num];
    return scheduled && Math.abs(new Date(scheduled.kickoffISO).getTime() - kickoffMs) < 60_000;
  });
  return byKickoff ?? null;
}

type ResolvedSlot =
  | { teamId: string; teamName: string; flagUrl?: string | null; placeholder?: undefined }
  | { teamId: null; teamName: null; flagUrl?: undefined; placeholder: string };

type BracketRow = {
  stage: string;
  slot: number;
  team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  points: number | null;
};

type TeamWithFlag = TeamLite & { flag_url: string | null };

type MatchRow = MatchLite & {
  kickoff_at: string;
  status: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  home_penalties: number | null;
  away_penalties: number | null;
  external_id: string | null;
  home_team: TeamWithFlag | null;
  away_team: TeamWithFlag | null;
};

type PredictionRow = PredLite & {
  points: number | null;
};

type PickRow = {
  teamId: string | null;
  home: number | null;
  away: number | null;
  points: number;
};

export function MatchesTab({ poolId }: { poolId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin", user?.id],
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

  // 11/06/2026 00:00 horário de Brasília (UTC-3) = 03:00 UTC
  const MATCHES_RELEASE_UTC = Date.UTC(2026, 5, 11, 3, 0, 0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const matchesLocked = now < MATCHES_RELEASE_UTC && !isAdmin;

  useEffect(() => {
    let ch = supabase
      .channel(`matches-live-${poolId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches" }, () => {
        qc.invalidateQueries({ queryKey: ["matches"] });
        qc.invalidateQueries({ queryKey: ["predictions", user?.id] });
      });

    if (user?.id) {
      ch = ch.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "predictions",
          filter: `user_id=eq.${user.id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["predictions", user?.id] }),
      );
    }

    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [poolId, qc, user?.id]);

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id,name,code,group_name,flag_url")
        .order("name");
      if (error) throw error;
      return data as TeamWithFlag[];
    },
  });

  const { data: matches } = useQuery<MatchRow[]>({
    queryKey: ["matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "*, home_team:teams!matches_home_team_id_fkey(*), away_team:teams!matches_away_team_id_fkey(*)",
        )
        .order("kickoff_at", { ascending: true });
      if (error) throw error;
      return data as MatchRow[];
    },
  });

  const { data: predictions } = useQuery<PredictionRow[]>({
    queryKey: ["predictions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("predictions")
        .select("*")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data as PredictionRow[];
    },
  });

  const { data: brackets } = useQuery({
    queryKey: ["brackets-mine", poolId, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bracket_predictions")
        .select("stage,slot,team_id,home_score,away_score,points")
        .eq("pool_id", poolId)
        .eq("user_id", user!.id);
      if (error) throw error;
      return data as BracketRow[];
    },
  });

  const { data: champ } = useQuery({
    queryKey: ["champion-mine", poolId, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("champion_predictions")
        .select("team_id")
        .eq("pool_id", poolId)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const groupMatchesLite = useMemo<MatchLite[] | null>(() => {
    if (!matches) return null;
    return matches.map((m) => ({
      id: m.id,
      stage: m.stage,
      group_name: m.group_name,
      home_team_id: m.home_team_id,
      away_team_id: m.away_team_id,
      kickoff_at: m.kickoff_at,
    }));
  }, [matches]);

  // Real qualifiers come from actual match results, not user predictions
  const realResultsAsPreds = useMemo<PredLite[]>(() => {
    return (matches ?? [])
      .filter((m) => m.home_score !== null && m.away_score !== null && m.status === "finished")
      .map((m) => ({ match_id: m.id, home_score: m.home_score!, away_score: m.away_score! }));
  }, [matches]);

  const realQualifiers = useMemo(() => {
    if (!teams || !groupMatchesLite) return null;
    return computeQualifiers(teams, groupMatchesLite, realResultsAsPreds);
  }, [teams, groupMatchesLite, realResultsAsPreds]);

  // A group is only "decided" when ALL of its group-stage matches are finished.
  const finishedGroups = useMemo(() => {
    const set = new Set<string>();
    if (!matches) return set;
    const byGroup = new Map<string, { total: number; done: number }>();
    for (const m of matches) {
      if (m.stage !== "group" || !m.group_name) continue;
      const g = byGroup.get(m.group_name) ?? { total: 0, done: 0 };
      g.total += 1;
      if (m.status === "finished" && m.home_score !== null && m.away_score !== null) g.done += 1;
      byGroup.set(m.group_name, g);
    }
    byGroup.forEach((v, k) => {
      if (v.total > 0 && v.done === v.total) set.add(k);
    });
    return set;
  }, [matches]);

  const predQualifiers = useMemo(() => {
    if (!teams || !groupMatchesLite) return null;
    return computeQualifiers(teams, groupMatchesLite, predictions ?? []);
  }, [teams, groupMatchesLite, predictions]);

  const realThirdsAssignment = useMemo(() => {
    if (!realQualifiers) return null;
    const groups = realQualifiers.qualified.filter((q) => q.position === 3).map((q) => q.group);
    return groups.length === 8 ? lookupThirdsAssignment(groups) : null;
  }, [realQualifiers]);

  const predThirdsAssignment = useMemo(() => {
    if (!predQualifiers) return null;
    const groups = predQualifiers.qualified.filter((q) => q.position === 3).map((q) => q.group);
    return groups.length === 8 ? lookupThirdsAssignment(groups) : null;
  }, [predQualifiers]);

  const teamsById = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t])), [teams]);

  const realMatchesByNum = useMemo(() => {
    const map = new Map<number, MatchRow>();
    (matches ?? []).forEach((m) => {
      const num = matchNumberFromRealMatch(m);
      if (num != null) map.set(num, m);
    });
    return map;
  }, [matches]);

  const picks = useMemo(() => {
    const map = new Map<number, PickRow>();
    (brackets ?? []).forEach((b) => {
      let n = 0;
      if (b.stage === "round_of_16") n = 73 + b.slot;
      else if (b.stage === "quarter") n = 89 + b.slot;
      else if (b.stage === "semi") n = 97 + b.slot;
      else if (b.stage === "final") n = b.slot === 2 ? FINAL.match : 101 + b.slot;
      else if (b.stage === "third_place") n = THIRD_PLACE_MATCH;
      else return;
      map.set(n, {
        teamId: b.team_id,
        home: b.home_score,
        away: b.away_score,
        points: b.points ?? 0,
      });
    });
    if (champ?.team_id) {
      const existing = map.get(FINAL.match) ?? { teamId: null, home: null, away: null, points: 0 };
      map.set(FINAL.match, { ...existing, teamId: champ.team_id });
    }
    return map;
  }, [brackets, champ]);

  function makeResolver(opts: { useRealQualifiers: boolean; useUserKO: boolean }) {
    const q = opts.useRealQualifiers ? realQualifiers : predQualifiers;
    const thirdsAssignment = opts.useRealQualifiers ? realThirdsAssignment : predThirdsAssignment;
    const gateGroup = (g: string) => !opts.useRealQualifiers || finishedGroups.has(g);
    function resolve(spec: SlotSpec, matchNum?: number): ResolvedSlot {
      if (!q) return { teamId: null, teamName: null, placeholder: "..." };
      const { byGroup } = q;
      if (spec.kind === "winner") {
        if (!gateGroup(spec.group))
          return { teamId: null, teamName: null, placeholder: `Vencedor Grupo ${spec.group}` };
        const row = byGroup[spec.group]?.[0];
        return row
          ? {
              teamId: row.team.id,
              teamName: row.team.name,
              flagUrl: teamsById.get(row.team.id)?.flag_url,
            }
          : { teamId: null, teamName: null, placeholder: `Vencedor Grupo ${spec.group}` };
      }
      if (spec.kind === "runnerUp") {
        if (!gateGroup(spec.group))
          return { teamId: null, teamName: null, placeholder: `2º Grupo ${spec.group}` };
        const row = byGroup[spec.group]?.[1];
        return row
          ? {
              teamId: row.team.id,
              teamName: row.team.name,
              flagUrl: teamsById.get(row.team.id)?.flag_url,
            }
          : { teamId: null, teamName: null, placeholder: `2º Grupo ${spec.group}` };
      }
      if (spec.kind === "third") {
        const placeholder = `3º Grupo ${spec.groups.join("/")}`;
        if (!thirdsAssignment || !matchNum) {
          return { teamId: null, teamName: null, placeholder };
        }

        const group = thirdsAssignment[matchNum];
        if (!group || (opts.useRealQualifiers && !gateGroup(group))) {
          return { teamId: null, teamName: null, placeholder };
        }

        const row = byGroup[group]?.[2];
        return row
          ? {
              teamId: row.team.id,
              teamName: row.team.name,
              flagUrl: teamsById.get(row.team.id)?.flag_url,
            }
          : { teamId: null, teamName: null, placeholder };
      }
      if (spec.kind === "matchWinner") {
        if (!opts.useUserKO) {
          return { teamId: null, teamName: null, placeholder: `Vencedor M${spec.match}` };
        }
        const teamId = picks.get(spec.match)?.teamId;
        const team = teamId ? teamsById.get(teamId) : null;
        return team
          ? { teamId: team.id, teamName: team.name, flagUrl: team.flag_url }
          : { teamId: null, teamName: null, placeholder: `Vencedor M${spec.match}` };
      }
      return { teamId: null, teamName: null, placeholder: "?" };
    }
    return resolve;
  }

  const resolveReal = makeResolver({ useRealQualifiers: true, useUserKO: false });
  const resolvePred = makeResolver({ useRealQualifiers: false, useUserKO: true });

  if (!matches?.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Nenhum jogo cadastrado ainda. Os jogos serão sincronizados em breve.
      </div>
    );
  }

  const groupStageMatches = matches.filter((m) => m.stage === "group");

  const byDate = groupStageMatches.reduce<Record<string, MatchRow[]>>((acc, m) => {
    const d = format(new Date(m.kickoff_at), "EEEE, dd 'de' MMMM", { locale: ptBR });
    (acc[d] = acc[d] || []).push(m);
    return acc;
  }, {});

  const byGroup = groupStageMatches.reduce<Record<string, MatchRow[]>>((acc, m) => {
    const g = m.group_name ?? "?";
    (acc[g] = acc[g] || []).push(m);
    return acc;
  }, {});
  const groupKeys = Object.keys(byGroup).sort();

  const knockoutSections: { label: string; icon?: React.ReactNode; matches: BracketMatch[] }[] = [
    { label: "Rodada de 32 (16 jogos)", matches: R32 },
    { label: "Oitavas de Final — Rodada de 16 (8 jogos)", matches: R16 },
    { label: "Quartas de Final (4 jogos)", matches: QF },
    { label: "Semifinais (2 jogos)", matches: SF },
  ];

  // Predicted 3rd place participants (from user's bracket): losers of M101/M102 in user's picks
  const sf101A = resolvePred(SF[0].a),
    sf101B = resolvePred(SF[0].b);
  const sf102A = resolvePred(SF[1].a),
    sf102B = resolvePred(SF[1].b);
  const w101 = picks.get(101)?.teamId;
  const w102 = picks.get(102)?.teamId;
  const tp = picks.get(THIRD_PLACE_MATCH);
  const thirdA_pred: ResolvedSlot =
    w101 && sf101A.teamId && sf101B.teamId
      ? w101 === sf101A.teamId
        ? sf101B
        : sf101A
      : { teamId: null, teamName: null, placeholder: "Perdedor M101" };
  const thirdB_pred: ResolvedSlot =
    w102 && sf102A.teamId && sf102B.teamId
      ? w102 === sf102A.teamId
        ? sf102B
        : sf102A
      : { teamId: null, teamName: null, placeholder: "Perdedor M102" };

  const finalPick = picks.get(FINAL.match);

  if (matchesLocked)
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <Trophy className="mx-auto mb-3 h-8 w-8 text-primary" />
        <p className="text-base font-semibold">Tabela da Copa ainda não disponível</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A Tabela da Copa será disponibilizada a partir do dia 11/06 às 00:00 (horário de
          Brasília).
        </p>
      </div>
    );

  return (
    <div className="space-y-8">
      <p className="text-xs text-muted-foreground">
        Esta tela é só para visualização. Para enviar ou alterar seus palpites, vá para as abas{" "}
        <strong className="text-foreground">Palpites Fase Grupo</strong> e{" "}
        <strong className="text-foreground">Chaveamento</strong>.
      </p>

      <GroupStageView
        byDate={byDate}
        byGroup={byGroup}
        groupKeys={groupKeys}
        predictions={predictions}
        standings={realQualifiers?.byGroup ?? {}}
        teamsById={teamsById}
      />

      {knockoutSections.map((sec) => (
        <section
          key={sec.label}
          className="rounded-xl border border-border bg-card overflow-hidden"
        >
          <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-3">
            <h3 className="text-base font-black uppercase tracking-tight">{sec.label}</h3>
            <span className="ml-auto text-xs text-muted-foreground">
              {sec.matches.length} {sec.matches.length === 1 ? "jogo" : "jogos"}
            </span>
          </header>
          <div className="divide-y divide-border">
            {sec.matches.map((bm) => {
              const real = realMatchesByNum.get(bm.match);
              const aReal: ResolvedSlot = real?.home_team
                ? {
                    teamId: real.home_team.id,
                    teamName: real.home_team.name,
                    flagUrl: real.home_team.flag_url,
                  }
                : resolveReal(bm.a, bm.match);
              const bReal: ResolvedSlot = real?.away_team
                ? {
                    teamId: real.away_team.id,
                    teamName: real.away_team.name,
                    flagUrl: real.away_team.flag_url,
                  }
                : resolveReal(bm.b, bm.match);
              const aPred = resolvePred(bm.a, bm.match);
              const bPred = resolvePred(bm.b, bm.match);
              const p = picks.get(bm.match);
              return (
                <KnockoutRow
                  key={bm.match}
                  matchNum={bm.match}
                  a={aReal}
                  b={bReal}
                  aPred={aPred}
                  bPred={bPred}
                  pick={p}
                  match={real}
                />
              );
            })}
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-3">
          <Trophy className="h-4 w-4 text-amber-500" />
          <h3 className="text-base font-black uppercase tracking-tight">Disputa de 3º Lugar</h3>
        </header>
        <div className="divide-y divide-border">
          {(() => {
            const real = realMatchesByNum.get(THIRD_PLACE_MATCH);
            const aReal: ResolvedSlot = real?.home_team
              ? {
                  teamId: real.home_team.id,
                  teamName: real.home_team.name,
                  flagUrl: real.home_team.flag_url,
                }
              : { teamId: null, teamName: null, placeholder: "Perdedor M101" };
            const bReal: ResolvedSlot = real?.away_team
              ? {
                  teamId: real.away_team.id,
                  teamName: real.away_team.name,
                  flagUrl: real.away_team.flag_url,
                }
              : { teamId: null, teamName: null, placeholder: "Perdedor M102" };
            return (
              <KnockoutRow
                matchNum={THIRD_PLACE_MATCH}
                a={aReal}
                b={bReal}
                aPred={thirdA_pred}
                bPred={thirdB_pred}
                pick={tp}
                match={real}
              />
            );
          })()}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-3">
          <Crown className="h-4 w-4 text-primary" />
          <h3 className="text-base font-black uppercase tracking-tight">Final</h3>
        </header>
        <div className="divide-y divide-border">
          {(() => {
            const real = realMatchesByNum.get(FINAL.match);
            const aReal: ResolvedSlot = real?.home_team
              ? {
                  teamId: real.home_team.id,
                  teamName: real.home_team.name,
                  flagUrl: real.home_team.flag_url,
                }
              : resolveReal(FINAL.a);
            const bReal: ResolvedSlot = real?.away_team
              ? {
                  teamId: real.away_team.id,
                  teamName: real.away_team.name,
                  flagUrl: real.away_team.flag_url,
                }
              : resolveReal(FINAL.b);
            return (
              <KnockoutRow
                matchNum={FINAL.match}
                a={aReal}
                b={bReal}
                aPred={resolvePred(FINAL.a)}
                bPred={resolvePred(FINAL.b)}
                pick={finalPick}
                match={real}
              />
            );
          })()}
        </div>
      </section>
    </div>
  );
}

function GroupStageView({
  byDate,
  byGroup,
  groupKeys,
  predictions,
  standings,
  teamsById,
}: {
  byDate: Record<string, MatchRow[]>;
  byGroup: Record<string, MatchRow[]>;
  groupKeys: string[];
  predictions: PredictionRow[] | undefined;
  standings: Record<string, StandingRow[]>;
  teamsById: Map<string, TeamWithFlag>;
}) {
  const [mode, setMode] = useState<"date" | "group">("date");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Fase de Grupos
        </h2>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as "date" | "group")}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="date" aria-label="Por data">
            <Calendar className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Por data</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="group" aria-label="Por chave">
            <LayoutGrid className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Por chave</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {mode === "date"
        ? Object.entries(byDate).map(([date, list]) => (
            <div key={date}>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {date}
              </h3>
              <div className="space-y-2">
                {list.map((m) => (
                  <GroupMatchCard
                    key={m.id}
                    match={m}
                    prediction={predictions?.find((p) => p.match_id === m.id)}
                  />
                ))}
              </div>
            </div>
          ))
        : groupKeys.map((g) => (
            <div key={g} className="rounded-xl border border-border bg-card/40 p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Grupo {g}
              </h3>
              <div className="grid gap-4 lg:grid-cols-[1fr_minmax(260px,340px)]">
                <div className="space-y-2">
                  {byGroup[g].map((m) => (
                    <GroupMatchCard
                      key={m.id}
                      match={m}
                      prediction={predictions?.find((p) => p.match_id === m.id)}
                    />
                  ))}
                </div>
                <StandingsMini rows={standings[g] ?? []} teamsById={teamsById} />
              </div>
            </div>
          ))}
    </div>
  );
}

function StandingsMini({
  rows,
  teamsById,
}: {
  rows: StandingRow[];
  teamsById: Map<string, TeamWithFlag>;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        Sem jogos finalizados ainda.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden self-start">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left font-semibold">#</th>
            <th className="px-2 py-2 text-left font-semibold">Seleção</th>
            <th className="px-1.5 py-2 text-right font-semibold">P</th>
            <th className="px-1.5 py-2 text-right font-semibold">J</th>
            <th className="px-1.5 py-2 text-right font-semibold">SG</th>
            <th className="px-1.5 py-2 text-right font-semibold">GP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const flag = teamsById.get(r.team.id)?.flag_url;
            const qualifies = i < 2;
            const dot = qualifies ? "bg-primary" : i === 2 ? "bg-amber-500" : "bg-transparent";
            return (
              <tr key={r.team.id} className="border-t border-border">
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                    <span className="tabular-nums">{i + 1}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {flag && (
                      <img src={flag} alt="" className="h-3.5 w-5 object-cover rounded-sm" />
                    )}
                    <span className="truncate font-medium">{r.team.name}</span>
                  </div>
                </td>
                <td className="px-1.5 py-1.5 text-right tabular-nums font-bold">{r.points}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{r.played}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">
                  {r.gd > 0 ? `+${r.gd}` : r.gd}
                </td>
                <td className="px-1.5 py-1.5 text-right tabular-nums">{r.gf}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-3 border-t border-border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Classificado
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Melhor 3º
        </span>
      </div>
    </div>
  );
}

function GroupMatchCard({ match, prediction }: { match: MatchRow; prediction?: PredictionRow }) {
  const started = new Date(match.kickoff_at) <= new Date();
  const finished = match.status === "finished";
  const live = match.status === "live";
  const hasOfficialScore = match.home_score !== null && match.away_score !== null;
  const showOfficialScore = finished || live || started || hasOfficialScore;
  const showPredictionPoints = prediction && (finished || live || started || hasOfficialScore);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Grupo {match.group_name ?? ""}
          {" · "}
          {format(new Date(match.kickoff_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
        </span>
        <span className="flex items-center gap-1 font-semibold">
          {finished ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-primary" />
              Encerrado
            </>
          ) : live ? (
            <>
              <Lock className="h-3 w-3 text-primary" />
              Ao vivo
            </>
          ) : started ? (
            <>
              <Lock className="h-3 w-3" />
              Em andamento
            </>
          ) : (
            <>
              <Clock className="h-3 w-3" />
              Agendado
            </>
          )}
        </span>
      </div>
      {match.venue && (
        <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          <span>{match.venue}</span>
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center gap-2 justify-end text-right">
          {match.home_team?.flag_url && (
            <img
              src={match.home_team.flag_url}
              alt=""
              className="h-5 w-7 object-cover rounded-sm"
            />
          )}
          <span className="font-semibold">{match.home_team?.name ?? "—"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {showOfficialScore ? (
            <div className="rounded bg-secondary px-3 py-1 font-bold tabular-nums">
              {match.home_score ?? "-"} - {match.away_score ?? "-"}
            </div>
          ) : (
            <div className="rounded border border-dashed border-border px-3 py-1 text-xs italic text-muted-foreground">
              vs
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold">{match.away_team?.name ?? "—"}</span>
          {match.away_team?.flag_url && (
            <img
              src={match.away_team.flag_url}
              alt=""
              className="h-5 w-7 object-cover rounded-sm"
            />
          )}
        </div>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {prediction ? (
          <>
            Seu palpite:{" "}
            <strong className="text-foreground">
              {prediction.home_score} × {prediction.away_score}
            </strong>
            {showPredictionPoints && (
              <>
                {" "}
                · <span className="text-primary font-bold">{prediction.points ?? 0} pts</span>
              </>
            )}
          </>
        ) : (
          <span className="italic">Você ainda não deu palpite neste jogo.</span>
        )}
      </div>
    </div>
  );
}

function KnockoutRow({
  matchNum,
  a,
  b,
  aPred,
  bPred,
  pick,
  match,
}: {
  matchNum: number;
  a: ResolvedSlot;
  b: ResolvedSlot;
  aPred: ResolvedSlot;
  bPred: ResolvedSlot;
  pick?: PickRow;
  match?: MatchRow;
}) {
  const hasPick = pick && (pick.home !== null || pick.away !== null || pick.teamId);
  const winnerId = pick?.teamId ?? null;
  const palpiteAName = aPred.teamId ? aPred.teamName : (aPred.placeholder ?? "?");
  const palpiteBName = bPred.teamId ? bPred.teamName : (bPred.placeholder ?? "?");
  const palpiteHome = pick?.home ?? 0;
  const palpiteAway = pick?.away ?? 0;
  const schedule = BRACKET_SCHEDULE[matchNum];
  const kickoff = match?.kickoff_at ?? schedule?.kickoffISO;
  const venue = match?.venue ?? schedule?.venue;
  const started = kickoff ? new Date(kickoff) <= new Date() : false;
  const finished = match?.status === "finished";
  const live = match?.status === "live";
  const hasOfficialScore =
    match?.home_score !== null &&
    match?.home_score !== undefined &&
    match?.away_score !== null &&
    match?.away_score !== undefined;
  const showOfficialScore = finished || live || started || hasOfficialScore;

  return (
    <div className="px-4 py-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Jogo {matchNum}
          {kickoff && (
            <>
              {" · "}
              {format(new Date(kickoff), "dd/MM 'às' HH:mm", { locale: ptBR })}
            </>
          )}
        </span>
        <span className="flex items-center gap-1 font-semibold">
          {finished ? (
            <>
              <CheckCircle2 className="h-3 w-3 text-primary" />
              Encerrado
            </>
          ) : live ? (
            <>
              <Lock className="h-3 w-3 text-primary" />
              Ao vivo
            </>
          ) : started ? (
            <>
              <Lock className="h-3 w-3" />
              Em andamento
            </>
          ) : (
            <>
              <Clock className="h-3 w-3" />
              Agendado
            </>
          )}
        </span>
      </div>
      {venue && (
        <div className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          <span>{venue}</span>
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center gap-2 justify-end text-right">
          {a.flagUrl && <img src={a.flagUrl} alt="" className="h-5 w-7 object-cover rounded-sm" />}
          <span className={`font-semibold ${a.teamId ? "" : "italic text-muted-foreground"}`}>
            {a.teamId ? a.teamName : (a.placeholder ?? "?")}
          </span>
        </div>
        {showOfficialScore ? (
          <div className="rounded bg-secondary px-3 py-1 text-center font-bold tabular-nums">
            <span>
              {match?.home_score ?? "-"} - {match?.away_score ?? "-"}
            </span>
            {match?.home_penalties != null && match?.away_penalties != null && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                pen. {match.home_penalties}×{match.away_penalties}
              </span>
            )}
          </div>
        ) : (
          <div className="rounded border border-dashed border-border px-3 py-1 text-xs italic text-muted-foreground">
            vs
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${b.teamId ? "" : "italic text-muted-foreground"}`}>
            {b.teamId ? b.teamName : (b.placeholder ?? "?")}
          </span>
          {b.flagUrl && <img src={b.flagUrl} alt="" className="h-5 w-7 object-cover rounded-sm" />}
        </div>
      </div>
      <div className="mt-2 text-xs">
        {hasPick ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-muted-foreground">
            Seu palpite:
            <span className="inline-flex items-center gap-1">
              {aPred.flagUrl && (
                <img src={aPred.flagUrl} alt="" className="h-3.5 w-5 object-cover rounded-sm" />
              )}
              <strong
                className={`text-foreground ${winnerId === aPred.teamId && winnerId ? "text-primary" : ""}`}
              >
                {palpiteAName}
              </strong>
            </span>
            <span className="font-bold">
              {palpiteHome} × {palpiteAway}
            </span>
            <span className="inline-flex items-center gap-1">
              {bPred.flagUrl && (
                <img src={bPred.flagUrl} alt="" className="h-3.5 w-5 object-cover rounded-sm" />
              )}
              <strong
                className={`text-foreground ${winnerId === bPred.teamId && winnerId ? "text-primary" : ""}`}
              >
                {palpiteBName}
              </strong>
            </span>
            {(pick!.points ?? 0) > 0 && (
              <span className="text-primary font-bold">· {pick!.points} pts</span>
            )}
          </span>
        ) : (
          <span className="italic text-muted-foreground">
            Você ainda não deu palpite neste jogo.
          </span>
        )}
      </div>
    </div>
  );
}
