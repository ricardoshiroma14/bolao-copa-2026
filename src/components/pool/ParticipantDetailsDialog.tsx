import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Crown, Trophy } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
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
import {
  computeQualifiers,
  type MatchLite,
  type PredLite,
  type TeamLite,
} from "@/lib/group-standings";
import { lookupThirdsAssignment } from "@/lib/wc2026-thirds-combinations";
import { BRACKET_SCHEDULE } from "@/lib/wc2026-bracket-schedule";

type Props = {
  poolId: string;
  userId: string | null;
  name: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

type Team = {
  id: string;
  name: string;
  code: string;
  group_name: string | null;
  flag_url: string | null;
};
type Match = {
  id: string;
  external_id: string | null;
  stage: string;
  group_name: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  kickoff_at: string;
  home_score: number | null;
  away_score: number | null;
  home_penalties: number | null;
  away_penalties: number | null;
  winner_team_id: string | null;
  status: string;
};
type Pred = { match_id: string; home_score: number; away_score: number; points: number };
type Bracket = {
  stage: string;
  slot: number;
  team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  points: number;
};

const STAGE_MATCH_BASE: Record<string, number> = {
  round_of_16: 73,
  quarter: 89,
  semi: 97,
  final: 101,
};

const BRACKET_MATCHES_BY_STAGE: Record<string, number[]> = {
  round_of_32: R32.map((m) => m.match),
  round_of_16: R16.map((m) => m.match),
  quarter: QF.map((m) => m.match),
  semi: SF.map((m) => m.match),
  third_place: [THIRD_PLACE_MATCH],
  final: [FINAL.match],
};

type ResolvedSlot =
  | { teamId: string; teamName: string; placeholder?: undefined }
  | { teamId: null; teamName: null; placeholder: string };

export function ParticipantDetailsDialog({ poolId, userId, name, open, onOpenChange }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["participant-details", poolId, userId],
    enabled: open && !!userId,
    queryFn: async () => {
      const [teamsRes, matchesRes, predsRes, bracketRes, champRes] = await Promise.all([
        supabase.from("teams").select("id,name,code,group_name,flag_url"),
        supabase
          .from("matches")
          .select(
            "id,external_id,stage,group_name,home_team_id,away_team_id,kickoff_at,home_score,away_score,home_penalties,away_penalties,winner_team_id,status",
          )
          .order("kickoff_at"),
        supabase
          .from("predictions")
          .select("match_id,home_score,away_score,points")
          .eq("user_id", userId!),
        supabase
          .from("bracket_predictions")
          .select("stage,slot,team_id,home_score,away_score,points")
          .eq("pool_id", poolId)
          .eq("user_id", userId!),
        supabase
          .from("champion_predictions")
          .select("team_id,points")
          .eq("pool_id", poolId)
          .eq("user_id", userId!)
          .maybeSingle(),
      ]);
      return {
        teams: (teamsRes.data ?? []) as Team[],
        matches: (matchesRes.data ?? []) as Match[],
        preds: (predsRes.data ?? []) as Pred[],
        brackets: (bracketRes.data ?? []) as Bracket[],
        champion: champRes.data as { team_id: string; points: number } | null,
      };
    },
  });

  const teamsById = new Map((data?.teams ?? []).map((t) => [t.id, t]));
  const predsByMatch = new Map((data?.preds ?? []).map((p) => [p.match_id, p]));
  const bracketByKey = new Map((data?.brackets ?? []).map((b) => [`${b.stage}-${b.slot}`, b]));
  const realMatchesByNum = useMemo(() => {
    const map = new Map<number, Match>();
    (data?.matches ?? []).forEach((match) => {
      const matchNum = matchNumberFromRealMatch(match);
      if (matchNum) map.set(matchNum, match);
    });
    return map;
  }, [data?.matches]);

  const groupMatches = (data?.matches ?? []).filter((m) => m.stage === "group");
  const groups = Array.from(
    new Set((data?.teams ?? []).map((t) => t.group_name).filter((g): g is string => !!g)),
  ).sort();

  const allBracketGames: { label: string; games: BracketMatch[] }[] = [
    { label: "16ª de final (Rodada de 32)", games: R32 },
    { label: "8ª de final (Oitavas)", games: R16 },
    { label: "4ª de final (Quartas)", games: QF },
    { label: "Semifinais", games: SF },
  ];

  // 3º lugar — armazenado em bracket_predictions com stage="third_place", slot 0 e 1
  const thirdPlaceHomePick = bracketByKey.get("third_place-0") ?? null;
  const thirdPlaceAwayPick = bracketByKey.get("third_place-1") ?? null;

  // Map matchNum -> winner pick (teamId)
  const picksByMatch = useMemo(() => {
    const m = new Map<number, string | null>();
    (data?.brackets ?? []).forEach((b) => {
      let n = 0;
      if (b.stage === "round_of_16") n = 73 + b.slot;
      else if (b.stage === "quarter") n = 89 + b.slot;
      else if (b.stage === "semi") n = 97 + b.slot;
      else if (b.stage === "final") n = b.slot === 2 ? 104 : 101 + b.slot;
      else return;
      m.set(n, b.team_id);
    });
    if (data?.champion?.team_id) m.set(FINAL.match, data.champion.team_id);
    return m;
  }, [data?.brackets, data?.champion]);

  const qualifiers = useMemo(() => {
    if (!data?.teams || !data?.matches) return null;
    return computeQualifiers(
      data.teams as TeamLite[],
      data.matches as MatchLite[],
      (data.preds ?? []) as PredLite[],
    );
  }, [data?.teams, data?.matches, data?.preds]);

  const thirdsAssignment = useMemo(() => {
    if (!qualifiers) return null;
    const gs = qualifiers.qualified.filter((q) => q.position === 3).map((q) => q.group);
    if (gs.length !== 8) return null;
    return lookupThirdsAssignment(gs);
  }, [qualifiers]);

  function resolve(spec: SlotSpec, matchNum?: number): ResolvedSlot {
    if (spec.kind === "matchWinner") {
      const tid = picksByMatch.get(spec.match) ?? null;
      const t = tid ? teamsById.get(tid) : null;
      return t
        ? { teamId: t.id, teamName: t.name }
        : { teamId: null, teamName: null, placeholder: `Vencedor M${spec.match}` };
    }
    if (!qualifiers) return { teamId: null, teamName: null, placeholder: "..." };
    const { byGroup } = qualifiers;
    if (spec.kind === "winner") {
      const row = byGroup[spec.group]?.[0];
      return row
        ? { teamId: row.team.id, teamName: row.team.name }
        : { teamId: null, teamName: null, placeholder: `1º ${spec.group}` };
    }
    if (spec.kind === "runnerUp") {
      const row = byGroup[spec.group]?.[1];
      return row
        ? { teamId: row.team.id, teamName: row.team.name }
        : { teamId: null, teamName: null, placeholder: `2º ${spec.group}` };
    }
    if (spec.kind === "third") {
      const placeholder = `3º ${spec.groups.join("/")}`;
      if (!thirdsAssignment || !matchNum) return { teamId: null, teamName: null, placeholder };
      const g = thirdsAssignment[matchNum];
      const row = g ? byGroup[g]?.[2] : null;
      return row
        ? { teamId: row.team.id, teamName: row.team.name }
        : { teamId: null, teamName: null, placeholder };
    }
    return { teamId: null, teamName: null, placeholder: "?" };
  }

  function TeamChip({ slot, side = "away" }: { slot: ResolvedSlot; side?: "home" | "away" }) {
    if (slot.teamId) {
      const t = teamsById.get(slot.teamId);
      const flag = t?.flag_url ? (
        <img src={t.flag_url} alt="" className="h-3 w-5 shrink-0 rounded-sm object-cover" />
      ) : null;
      return (
        <span
          className={`inline-flex min-w-0 items-center gap-1.5 ${side === "home" ? "justify-end text-right" : "justify-start"}`}
        >
          {side === "home" ? (
            <>
              <span className="truncate">{t?.name ?? slot.teamName}</span>
              {flag}
            </>
          ) : (
            <>
              {flag}
              <span className="truncate">{t?.name ?? slot.teamName}</span>
            </>
          )}
        </span>
      );
    }
    return (
      <span
        className={`block truncate italic text-muted-foreground ${side === "home" ? "text-right" : ""}`}
      >
        {slot.placeholder}
      </span>
    );
  }

  function slotFromTeamId(teamId: string | null, placeholder: string): ResolvedSlot {
    const team = teamId ? teamsById.get(teamId) : null;
    return team
      ? { teamId: team.id, teamName: team.name }
      : { teamId: null, teamName: null, placeholder };
  }

  function finalSummary() {
    const finalHomePick = bracketByKey.get("final-0") ?? null;
    const finalAwayPick = bracketByKey.get("final-1") ?? null;
    const finalMatchPick = bracketByKey.get("final-2") ?? null;
    const homeId = finalHomePick?.team_id ?? null;
    const awayId = finalAwayPick?.team_id ?? null;
    const finalistIds = [homeId, awayId].filter((id): id is string => !!id);
    const storedChampionId = finalMatchPick?.team_id ?? data?.champion?.team_id ?? null;
    const validStoredChampionId = finalistIds.includes(storedChampionId ?? "")
      ? storedChampionId
      : null;

    let champId: string | null = validStoredChampionId;
    if (finalMatchPick?.home_score != null && finalMatchPick.away_score != null) {
      if (finalMatchPick.home_score > finalMatchPick.away_score) champId = homeId;
      else if (finalMatchPick.away_score > finalMatchPick.home_score) champId = awayId;
    }

    return {
      champId,
      viceId: finalistIds.find((id) => id !== champId) ?? null,
      finalMatchPick,
    };
  }

  function ScoreBadge({
    home,
    away,
    variant,
  }: {
    home: number | null | undefined;
    away: number | null | undefined;
    variant: "pick" | "real";
  }) {
    const hasScore = home != null && away != null;
    if (variant === "pick") {
      return (
        <span className="inline-block min-w-[2.5rem] rounded bg-muted px-1.5 py-0.5 text-center font-mono text-[11px] font-bold tabular-nums">
          {hasScore ? `${home}×${away}` : "—"}
        </span>
      );
    }
    return (
      <span className="inline-block min-w-[2.5rem] text-center font-mono text-[11px] font-bold tabular-nums text-foreground">
        {hasScore ? `${home}×${away}` : "—"}
      </span>
    );
  }

  function PointsCell({ points }: { points?: number | null }) {
    return (
      <span className="w-10 text-right text-[11px] font-bold tabular-nums text-primary">
        {points == null ? "-" : `+${points}`}
      </span>
    );
  }

  // Score-only points (PE / VC+PE / VCPI) — excludes qualifier/source bonus.
  // Returns null when not eligible (match not finished or user didn't predict a placar).
  function scoreOnlyPoints(
    pick: { home_score: number | null; away_score: number | null } | null | undefined,
    realMatch: { home_score: number | null; away_score: number | null } | undefined,
  ): number | null {
    if (!pick || pick.home_score == null || pick.away_score == null) return null;
    if (!realMatch || realMatch.home_score == null || realMatch.away_score == null) return null;
    const ph = pick.home_score,
      pa = pick.away_score,
      rh = realMatch.home_score,
      ra = realMatch.away_score;
    if (ph === rh && pa === ra) return 10;
    if (Math.sign(ph - pa) !== Math.sign(rh - ra)) return 0;
    if (ph === rh || pa === ra) return 7;
    return 5;
  }

  function MatchupCell({
    aSlot,
    bSlot,
    home,
    away,
    variant,
    winnerId,
    penaltiesHome,
    penaltiesAway,
  }: {
    aSlot: ResolvedSlot;
    bSlot: ResolvedSlot;
    home: number | null | undefined;
    away: number | null | undefined;
    variant: "pick" | "real";
    winnerId?: string | null;
    penaltiesHome?: number | null;
    penaltiesAway?: number | null;
  }) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 min-w-0">
        <span
          className={`min-w-0 justify-self-end text-right font-semibold ${winnerId && winnerId === aSlot.teamId ? "text-primary" : ""}`}
        >
          <TeamChip slot={aSlot} side="home" />
        </span>
        <span className="flex flex-col items-center">
          <ScoreBadge home={home} away={away} variant={variant} />
          {penaltiesHome != null && penaltiesAway != null && (
            <span className="text-[9px] text-muted-foreground tabular-nums">
              pen {penaltiesHome}×{penaltiesAway}
            </span>
          )}
        </span>
        <span
          className={`min-w-0 justify-self-start font-semibold ${winnerId && winnerId === bSlot.teamId ? "text-primary" : ""}`}
        >
          <TeamChip slot={bSlot} />
        </span>
      </div>
    );
  }

  function BracketPredictionRow({
    matchNum,
    aSlot,
    bSlot,
    pick,
    points,
    winnerId,
  }: {
    matchNum: number;
    aSlot: ResolvedSlot;
    bSlot: ResolvedSlot;
    pick?: Bracket | null;
    points?: number | null;
    winnerId?: string | null;
  }) {
    const realMatch = realMatchesByNum.get(matchNum);
    const realA: ResolvedSlot = realMatch?.home_team_id
      ? slotFromTeamId(realMatch.home_team_id, "—")
      : { teamId: null, teamName: null, placeholder: "—" };
    const realB: ResolvedSlot = realMatch?.away_team_id
      ? slotFromTeamId(realMatch.away_team_id, "—")
      : { teamId: null, teamName: null, placeholder: "—" };
    const realWinnerId = realMatch?.winner_team_id ?? null;
    // Only eligible for PE/VC+PE/VCPI when both palpite teams perfectly match the real teams.
    const sameOrientation =
      !!aSlot.teamId &&
      !!bSlot.teamId &&
      aSlot.teamId === realMatch?.home_team_id &&
      bSlot.teamId === realMatch?.away_team_id;
    const flippedOrientation =
      !!aSlot.teamId &&
      !!bSlot.teamId &&
      aSlot.teamId === realMatch?.away_team_id &&
      bSlot.teamId === realMatch?.home_team_id;
    const teamsMatch = sameOrientation || flippedOrientation;
    const pickForScore =
      pick && teamsMatch && flippedOrientation
        ? { home_score: pick.away_score, away_score: pick.home_score }
        : pick;
    const scorePts = teamsMatch ? scoreOnlyPoints(pickForScore ?? null, realMatch) : null;
    return (
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-center gap-2 px-3 py-2 text-xs">
        <span className="text-[10px] font-bold text-muted-foreground">M{matchNum}</span>
        <MatchupCell
          aSlot={aSlot}
          bSlot={bSlot}
          home={pick?.home_score}
          away={pick?.away_score}
          variant="pick"
          winnerId={winnerId}
        />
        <MatchupCell
          aSlot={realA}
          bSlot={realB}
          home={realMatch?.home_score}
          away={realMatch?.away_score}
          variant="real"
          winnerId={realWinnerId}
          penaltiesHome={realMatch?.home_penalties}
          penaltiesAway={realMatch?.away_penalties}
        />
        <PointsCell points={points !== undefined ? points : scorePts} />
      </div>
    );
  }

  function BracketSectionHeader() {
    return (
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-center gap-2 border-b border-border bg-muted/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        <span>Jogo</span>
        <span className="text-center">Palpite</span>
        <span className="text-center">Resultado oficial</span>
        <span className="text-right">Pts</span>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-black uppercase tracking-tight">
            Palpites de {name}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : (
          <Tabs defaultValue="groups">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="groups">Fase de Grupos</TabsTrigger>
              <TabsTrigger value="bracket">Chaveamento</TabsTrigger>
              <TabsTrigger value="champion">Final</TabsTrigger>
            </TabsList>

            <TabsContent value="groups" className="mt-4 space-y-5">
              {groups.map((g) => {
                const gms = groupMatches.filter((m) => m.group_name === g);
                return (
                  <section key={g} className="rounded-lg border border-border overflow-hidden">
                    <header className="bg-muted/30 px-3 py-2 text-xs font-black uppercase tracking-wider">
                      Grupo {g}
                    </header>
                    <div className="divide-y divide-border">
                      {gms.map((m) => {
                        const h = teamsById.get(m.home_team_id ?? "");
                        const a = teamsById.get(m.away_team_id ?? "");
                        const p = predsByMatch.get(m.id);
                        const hasReal =
                          m.home_score != null &&
                          m.away_score != null &&
                          ["finished", "live"].includes(m.status);
                        return (
                          <div
                            key={m.id}
                            className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 px-3 py-2 text-xs"
                          >
                            <div className="flex items-center justify-end gap-1.5 min-w-0">
                              <span className="truncate font-medium">{h?.name ?? "—"}</span>
                              {h?.flag_url && (
                                <img
                                  src={h.flag_url}
                                  alt=""
                                  className="h-3 w-5 rounded-sm object-cover"
                                />
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 font-mono tabular-nums">
                              <span className="rounded bg-muted px-1.5 py-0.5 font-bold">
                                {p ? `${p.home_score}×${p.away_score}` : "—"}
                              </span>
                              {hasReal && (
                                <span className="text-muted-foreground text-[10px]">
                                  ({m.home_score}×{m.away_score})
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0">
                              {a?.flag_url && (
                                <img
                                  src={a.flag_url}
                                  alt=""
                                  className="h-3 w-5 rounded-sm object-cover"
                                />
                              )}
                              <span className="truncate font-medium">{a?.name ?? "—"}</span>
                            </div>
                            <span className="text-right text-[11px] font-bold tabular-nums text-primary w-10">
                              {scoreOnlyPoints(
                                p ?? null,
                                hasReal
                                  ? { home_score: m.home_score, away_score: m.away_score }
                                  : undefined,
                              ) == null
                                ? "-"
                                : `+${scoreOnlyPoints(p ?? null, { home_score: m.home_score, away_score: m.away_score })}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </TabsContent>

            <TabsContent value="bracket" className="mt-4 space-y-5">
              {allBracketGames.map(({ label, games }) => (
                <section key={label} className="rounded-lg border border-border overflow-hidden">
                  <header className="bg-muted/30 px-3 py-2 text-xs font-black uppercase tracking-wider">
                    {label}
                  </header>
                  <BracketSectionHeader />
                  <div className="divide-y divide-border">
                    {games.map((g) => {
                      const stage = stageFromMatchNum(g.match);
                      const slot = slotFromMatchNum(g.match);
                      const b = bracketByKey.get(`${stage}-${slot}`);
                      const aSlot = resolve(g.a, g.match);
                      const bSlot = resolve(g.b, g.match);
                      const winnerId = b?.team_id ?? null;
                      return (
                        <BracketPredictionRow
                          key={g.match}
                          matchNum={g.match}
                          aSlot={aSlot}
                          bSlot={bSlot}
                          pick={b}
                          winnerId={winnerId}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}

              {(thirdPlaceHomePick || thirdPlaceAwayPick) &&
                (() => {
                  const realM103 = realMatchesByNum.get(THIRD_PLACE_MATCH);
                  const winnerId = realM103?.winner_team_id ?? null;
                  const aId = thirdPlaceHomePick?.team_id ?? null;
                  const bId = thirdPlaceAwayPick?.team_id ?? null;
                  const realHome = realM103?.home_team_id ?? null;
                  const realAway = realM103?.away_team_id ?? null;
                  const teamsMatch =
                    !!realHome &&
                    !!realAway &&
                    !!aId &&
                    !!bId &&
                    ((aId === realHome && bId === realAway) ||
                      (aId === realAway && bId === realHome));
                  const scoreFor = (p: Bracket | null | undefined) => {
                    if (!teamsMatch || !p || !winnerId || p.team_id !== winnerId) return null;
                    return scoreOnlyPoints(p, realM103);
                  };
                  const sHome = scoreFor(thirdPlaceHomePick);
                  const sAway = scoreFor(thirdPlaceAwayPick);
                  const totalScore = !teamsMatch
                    ? null
                    : sHome == null && sAway == null
                      ? null
                      : (sHome ?? 0) + (sAway ?? 0);

                  return (
                    <section className="rounded-lg border border-border overflow-hidden">
                      <header className="bg-muted/30 px-3 py-2 text-xs font-black uppercase tracking-wider">
                        Disputa de 3º lugar
                      </header>
                      <BracketSectionHeader />
                      <div className="divide-y divide-border">
                        <BracketPredictionRow
                          matchNum={THIRD_PLACE_MATCH}
                          aSlot={slotFromTeamId(
                            thirdPlaceHomePick?.team_id ?? null,
                            "Perdedor M101",
                          )}
                          bSlot={slotFromTeamId(
                            thirdPlaceAwayPick?.team_id ?? null,
                            "Perdedor M102",
                          )}
                          pick={thirdPlaceHomePick ?? thirdPlaceAwayPick ?? null}
                          points={totalScore}
                          winnerId={winnerId}
                        />
                      </div>
                    </section>
                  );
                })()}

              {(() => {
                const g = FINAL;
                const { champId, finalMatchPick } = finalSummary();
                const aSlot = resolve(g.a, g.match);
                const bSlot = resolve(g.b, g.match);
                return (
                  <section className="rounded-lg border border-border overflow-hidden">
                    <header className="bg-muted/30 px-3 py-2 text-xs font-black uppercase tracking-wider">
                      Final
                    </header>
                    <BracketSectionHeader />
                    <div className="divide-y divide-border">
                      <BracketPredictionRow
                        matchNum={g.match}
                        aSlot={aSlot}
                        bSlot={bSlot}
                        pick={finalMatchPick}
                        winnerId={champId}
                      />
                    </div>
                  </section>
                );
              })()}
            </TabsContent>

            <TabsContent value="champion" className="mt-4">
              {(() => {
                const { champId, viceId } = finalSummary();

                const Card = ({
                  title,
                  teamId,
                  icon,
                }: {
                  title: string;
                  teamId: string | null;
                  icon: React.ReactNode;
                }) => {
                  const team = teamId ? teamsById.get(teamId) : null;
                  return (
                    <div className="flex-1 rounded-lg border border-border bg-card p-6 text-center">
                      <div className="mx-auto mb-2 flex justify-center text-primary">{icon}</div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                        {title}
                      </div>
                      {team ? (
                        <div className="mt-1 inline-flex items-center gap-2 text-lg font-black">
                          {team.flag_url && (
                            <img
                              src={team.flag_url}
                              alt=""
                              className="h-5 w-7 rounded-sm object-cover"
                            />
                          )}
                          {team.name}
                        </div>
                      ) : (
                        <div className="mt-1 text-sm italic text-muted-foreground">—</div>
                      )}
                    </div>
                  );
                };

                return (
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Card title="Campeão" teamId={champId} icon={<Crown className="h-8 w-8" />} />
                    <Card
                      title="Vice-Campeão"
                      teamId={viceId}
                      icon={<Trophy className="h-8 w-8" />}
                    />
                  </div>
                );
              })()}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function stageFromMatchNum(n: number): string {
  if (n >= 73 && n <= 88) return "round_of_16";
  if (n >= 89 && n <= 96) return "quarter";
  if (n >= 97 && n <= 100) return "semi";
  if (n === 101 || n === 102 || n === 104) return "final";
  return "";
}
function slotFromMatchNum(n: number): number {
  if (n === FINAL.match) return 2;
  const stage = stageFromMatchNum(n);
  return n - (STAGE_MATCH_BASE[stage] ?? 0);
}

function hasRealScore(match?: Match): boolean {
  return !!match && match.home_score != null && match.away_score != null;
}

function formatRealScore(match?: Match): string | null {
  if (!hasRealScore(match)) return null;
  const regular = `${match!.home_score}×${match!.away_score}`;
  if (match!.home_penalties != null && match!.away_penalties != null) {
    return `${regular} pen. ${match!.home_penalties}×${match!.away_penalties}`;
  }
  return regular;
}

function matchNumberFromRealMatch(match: Match): number | null {
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
