import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Crown, Lock, Printer, Save, Trophy } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import {
  computeQualifiers,
  type MatchLite,
  type PredLite,
  type TeamLite,
} from "@/lib/group-standings";
import {
  FINAL,
  QF,
  R16,
  R32,
  SF,
  THIRD_PLACE_MATCH,
  storageFor,
  type BracketMatch,
  type SlotSpec,
} from "@/lib/wc2026-bracket";
import { BRACKET_SCHEDULE } from "@/lib/wc2026-bracket-schedule";
import { lookupThirdsAssignment } from "@/lib/wc2026-thirds-combinations";

const LOCK_HOURS_BEFORE_START = 48;
const EMPTY_DRAFT: DraftPick = { home: "", away: "", winnerId: null };

type BracketInsert = Database["public"]["Tables"]["bracket_predictions"]["Insert"];
type TeamWithFlag = TeamLite & { flag_url: string | null };

type ResolvedSlot =
  | { teamId: string; teamName: string; flagUrl?: string | null; placeholder?: undefined }
  | { teamId: null; teamName: null; placeholder: string };

type BracketRow = {
  stage: string;
  slot: number;
  team_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

type DraftPick = {
  home: string;
  away: string;
  winnerId: string | null;
};

type DraftRow = {
  match: BracketMatch;
  a: ResolvedSlot;
  b: ResolvedSlot;
  draft: DraftPick;
  saved: DraftPick;
};

type Phase = {
  label: string;
  saveLabel: string;
  matches: BracketMatch[];
  icon?: ReactNode;
};

type RawMatch = {
  id: string;
  external_id: string | null;
  stage: Database["public"]["Enums"]["match_stage"];
  group_name: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  kickoff_at: string;
};

type PrintRow = {
  key: string;
  matchNum: number | null;
  kickoffAt: string;
  home: string;
  away: string;
  homePick: number | null;
  awayPick: number | null;
  winner: string | null;
  isGroup: boolean;
};

const MATCH_NUM_RE = /\b(?:M|match[-_ ]?)?(\d{2,3})\b/i;

function parseMatchNumber(externalId: string | null): number | null {
  const parsed = externalId?.match(MATCH_NUM_RE);
  if (!parsed) return null;
  const num = Number(parsed[1]);
  return Number.isInteger(num) ? num : null;
}

function bestMatchNumFromKickoff(kickoffAt: string): number | null {
  const target = new Date(kickoffAt).getTime();
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestNum: number | null = null;

  for (const [matchStr, schedule] of Object.entries(BRACKET_SCHEDULE)) {
    const num = Number(matchStr);
    const diff = Math.abs(new Date(schedule.kickoffISO).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestNum = num;
    }
  }

  return bestDiff <= 90 * 60 * 1000 ? bestNum : null;
}

function formatScore(value: number | null): string {
  return value === null ? "—" : String(value);
}

export function BracketTab({ poolId }: { poolId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<number, DraftPick>>({});

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

  const { data: matchesAll } = useQuery({
    queryKey: ["matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("id,external_id,stage,group_name,home_team_id,away_team_id,kickoff_at")
        .order("kickoff_at", { ascending: true });
      if (error) throw error;
      return data as RawMatch[];
    },
  });

  const { data: groupPreds } = useQuery({
    queryKey: ["predictions-of", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("predictions")
        .select("match_id,home_score,away_score")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data as PredLite[];
    },
  });

  const { data: brackets } = useQuery({
    queryKey: ["brackets", poolId, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bracket_predictions")
        .select("stage,slot,team_id,home_score,away_score")
        .eq("pool_id", poolId)
        .eq("user_id", user!.id);
      if (error) throw error;
      return data as BracketRow[];
    },
  });

  const { data: champ } = useQuery({
    queryKey: ["champion", poolId, user?.id],
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

  // Lock: fixed deadline 10/06/2026 14:00 Brasília (UTC-3) = 17:00 UTC
  const LOCK_DEADLINE_UTC = Date.UTC(2026, 5, 10, 17, 0, 0);
  const firstKickoff = useMemo(() => {
    if (!matchesAll?.length) return null;
    return new Date(matchesAll[0].kickoff_at);
  }, [matchesAll]);
  const locked = Date.now() >= LOCK_DEADLINE_UTC;
  const lockDeadline = new Date(LOCK_DEADLINE_UTC);

  const teamsById = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t])), [teams]);

  const bracketByKey = useMemo(() => {
    const map = new Map<string, BracketRow>();
    (brackets ?? []).forEach((b) => map.set(`${b.stage}-${b.slot}`, b));
    return map;
  }, [brackets]);

  const picks = useMemo(() => {
    const map = new Map<
      number,
      { teamId: string | null; home: number | null; away: number | null }
    >();
    (brackets ?? []).forEach((b) => {
      let matchNum = 0;
      if (b.stage === "round_of_16") matchNum = 73 + b.slot;
      else if (b.stage === "quarter") matchNum = 89 + b.slot;
      else if (b.stage === "semi") matchNum = 97 + b.slot;
      else if (b.stage === "final") matchNum = b.slot === 2 ? FINAL.match : 101 + b.slot;
      else return;

      map.set(matchNum, { teamId: b.team_id, home: b.home_score, away: b.away_score });
    });

    if (champ?.team_id) {
      const existing = map.get(FINAL.match) ?? { teamId: null, home: null, away: null };
      map.set(FINAL.match, { ...existing, teamId: champ.team_id });
    }

    return map;
  }, [brackets, champ]);

  const qualifiers = useMemo(() => {
    if (!teams || !matchesAll) return null;
    return computeQualifiers(teams, matchesAll as MatchLite[], groupPreds ?? []);
  }, [teams, matchesAll, groupPreds]);

  const thirdsAssignment = useMemo(() => {
    if (!qualifiers) return null;
    const groups = qualifiers.qualified.filter((q) => q.position === 3).map((q) => q.group);
    if (groups.length !== 8) return null;
    return lookupThirdsAssignment(groups);
  }, [qualifiers]);

  const resolve = useCallback(
    (spec: SlotSpec, matchNum?: number): ResolvedSlot => {
      if (!qualifiers) return { teamId: null, teamName: null, placeholder: "..." };
      const { byGroup } = qualifiers;

      if (spec.kind === "winner") {
        const row = byGroup[spec.group]?.[0];
        return row
          ? {
              teamId: row.team.id,
              teamName: row.team.name,
              flagUrl: (row.team as TeamWithFlag).flag_url,
            }
          : { teamId: null, teamName: null, placeholder: `Vencedor Grupo ${spec.group}` };
      }

      if (spec.kind === "runnerUp") {
        const row = byGroup[spec.group]?.[1];
        return row
          ? {
              teamId: row.team.id,
              teamName: row.team.name,
              flagUrl: (row.team as TeamWithFlag).flag_url,
            }
          : { teamId: null, teamName: null, placeholder: `2º Grupo ${spec.group}` };
      }

      if (spec.kind === "third") {
        const placeholder = `3º Grupo ${spec.groups.join("/")}`;
        if (!thirdsAssignment || !matchNum) {
          return { teamId: null, teamName: null, placeholder };
        }

        const group = thirdsAssignment[matchNum];
        const row = group ? byGroup[group]?.[2] : null;
        return row
          ? {
              teamId: row.team.id,
              teamName: row.team.name,
              flagUrl: (row.team as TeamWithFlag).flag_url,
            }
          : { teamId: null, teamName: null, placeholder };
      }

      if (spec.kind === "matchWinner") {
        const teamId = picks.get(spec.match)?.teamId;
        const team = teamId ? teamsById.get(teamId) : null;
        return team
          ? { teamId: team.id, teamName: team.name, flagUrl: team.flag_url }
          : { teamId: null, teamName: null, placeholder: `Vencedor M${spec.match}` };
      }

      return { teamId: null, teamName: null, placeholder: "?" };
    },
    [qualifiers, thirdsAssignment, teamsById, picks],
  );

  const sf101A = resolve(SF[0].a);
  const sf101B = resolve(SF[0].b);
  const sf102A = resolve(SF[1].a);
  const sf102B = resolve(SF[1].b);
  const winner101 = picks.get(101)?.teamId;
  const winner102 = picks.get(102)?.teamId;
  const loser101 = loserFromSemi(winner101, sf101A, sf101B, "Perdedor M101");
  const loser102 = loserFromSemi(winner102, sf102A, sf102B, "Perdedor M102");
  const thirdPlaceSlot0 = bracketByKey.get("third_place-0") ?? null;
  const thirdPlaceSlot1 = bracketByKey.get("third_place-1") ?? null;
  const thirdPlaceA = slotFromStoredTeam(thirdPlaceSlot0?.team_id, teamsById, loser101);
  const thirdPlaceB = slotFromStoredTeam(thirdPlaceSlot1?.team_id, teamsById, loser102);

  const savedDrafts = useMemo(() => {
    const map: Record<number, DraftPick> = {};

    [...R32, ...R16, ...QF, ...SF, FINAL].forEach((m) => {
      const pick = picks.get(m.match);
      map[m.match] = {
        home: scoreToInput(pick?.home),
        away: scoreToInput(pick?.away),
        winnerId: pick?.teamId ?? null,
      };
    });

    const thirdHome = thirdPlaceSlot0?.home_score ?? thirdPlaceSlot1?.home_score ?? null;
    const thirdAway = thirdPlaceSlot0?.away_score ?? thirdPlaceSlot1?.away_score ?? null;
    map[THIRD_PLACE_MATCH] = {
      home: scoreToInput(thirdHome),
      away: scoreToInput(thirdAway),
      winnerId:
        thirdHome !== null && thirdAway !== null && thirdHome === thirdAway
          ? (thirdPlaceSlot0?.team_id ?? null)
          : null,
    };

    return map;
  }, [picks, thirdPlaceSlot0, thirdPlaceSlot1]);

  useEffect(() => {
    setDrafts(savedDrafts);
  }, [savedDrafts]);

  const savePhase = useMutation({
    mutationFn: async ({
      label,
      rows,
      championId,
    }: {
      label: string;
      rows: BracketInsert[];
      championId?: string | null;
    }) => {
      if (!user) throw new Error("Faça login para salvar seus palpites");
      if (locked) throw new Error("Palpites bloqueados");
      if (!rows.length) throw new Error("Nenhum palpite para salvar");

      const { error } = await supabase.from("bracket_predictions").upsert(rows, {
        onConflict: "user_id,pool_id,stage,slot",
      });
      if (error) throw error;

      if (championId) {
        const { error: championError } = await supabase
          .from("champion_predictions")
          .upsert(
            { user_id: user.id, pool_id: poolId, team_id: championId },
            { onConflict: "user_id,pool_id" },
          );
        if (championError) throw championError;
      }

      return label;
    },
    onSuccess: (label) => {
      qc.invalidateQueries({ queryKey: ["brackets", poolId, user?.id] });
      qc.invalidateQueries({ queryKey: ["brackets-mine", poolId, user?.id] });
      qc.invalidateQueries({ queryKey: ["champion", poolId, user?.id] });
      qc.invalidateQueries({ queryKey: ["champion-mine", poolId, user?.id] });
      toast.success(`${label} salvo`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const phases = useMemo<Phase[]>(
    () => [
      { label: "16ª de final (Rodada de 32)", saveLabel: "16ª de final", matches: R32 },
      { label: "8ª de final (Oitavas)", saveLabel: "8ª de final", matches: R16 },
      { label: "Quartas de final", saveLabel: "Quartas de final", matches: QF },
      { label: "Semifinal", saveLabel: "Semifinal", matches: SF },
    ],
    [],
  );

  const getDraft = useCallback(
    (matchNum: number): DraftPick => drafts[matchNum] ?? savedDrafts[matchNum] ?? EMPTY_DRAFT,
    [drafts, savedDrafts],
  );

  function updateDraft(matchNum: number, patch: Partial<DraftPick>) {
    setDrafts((prev) => ({
      ...prev,
      [matchNum]: {
        ...(prev[matchNum] ?? savedDrafts[matchNum] ?? EMPTY_DRAFT),
        ...patch,
      },
    }));
  }

  const rowsFor = useCallback(
    (matches: BracketMatch[]): DraftRow[] => {
      return matches.map((match) => ({
        match,
        a: resolve(match.a, match.match),
        b: resolve(match.b, match.match),
        draft: getDraft(match.match),
        saved: savedDrafts[match.match] ?? EMPTY_DRAFT,
      }));
    },
    [getDraft, resolve, savedDrafts],
  );

  function saveNormalPhase(label: string, rows: DraftRow[]) {
    if (!user) throw new Error("Faça login para salvar");
    const upserts: BracketInsert[] = [];
    let championId: string | null = null;

    rows.forEach((row) => {
      const home = parseScore(row.draft.home);
      const away = parseScore(row.draft.away);
      const winnerId = effectiveWinner(row.draft, row.a, row.b);
      const slot = storageFor(row.match.match);

      if (!slot || !row.a.teamId || !row.b.teamId || home === null || away === null || !winnerId) {
        throw new Error(`Complete todos os jogos de ${label}`);
      }

      upserts.push({
        user_id: user.id,
        pool_id: poolId,
        stage: slot.stage,
        slot: slot.slot,
        team_id: winnerId,
        home_score: home,
        away_score: away,
      });

      if ((row.match.match === 101 || row.match.match === 102) && row.a.teamId && row.b.teamId) {
        const loserId = winnerId === row.a.teamId ? row.b.teamId : row.a.teamId;
        const existingThirdPlaceSlot = row.match.match === 101 ? thirdPlaceSlot0 : thirdPlaceSlot1;
        const shouldKeepThirdPlaceScore = existingThirdPlaceSlot?.team_id === loserId;
        upserts.push({
          user_id: user.id,
          pool_id: poolId,
          stage: "third_place",
          slot: row.match.match - 101,
          team_id: loserId,
          home_score: shouldKeepThirdPlaceScore ? existingThirdPlaceSlot.home_score : null,
          away_score: shouldKeepThirdPlaceScore ? existingThirdPlaceSlot.away_score : null,
        });
      }

      if (row.match.match === FINAL.match) {
        championId = winnerId;
      }
    });

    savePhase.mutate({ label, rows: upserts, championId });
  }

  function saveThirdPlace() {
    if (!user) throw new Error("Faça login para salvar");
    const draft = getDraft(THIRD_PLACE_MATCH);
    const home = parseScore(draft.home);
    const away = parseScore(draft.away);
    const winnerId = effectiveWinner(draft, thirdPlaceA, thirdPlaceB);

    if (!thirdPlaceA.teamId || !thirdPlaceB.teamId || home === null || away === null || !winnerId) {
      throw new Error("Complete a disputa de 3º colocado");
    }

    const firstTeamId =
      home === away && winnerId === thirdPlaceB.teamId ? thirdPlaceB.teamId : thirdPlaceA.teamId;
    const secondTeamId =
      firstTeamId === thirdPlaceA.teamId ? thirdPlaceB.teamId : thirdPlaceA.teamId;

    savePhase.mutate({
      label: "3º colocado",
      rows: [
        {
          user_id: user.id,
          pool_id: poolId,
          stage: "third_place",
          slot: 0,
          team_id: firstTeamId,
          home_score: home,
          away_score: away,
        },
        {
          user_id: user.id,
          pool_id: poolId,
          stage: "third_place",
          slot: 1,
          team_id: secondTeamId,
          home_score: home,
          away_score: away,
        },
      ],
    });
  }

  const finalRows = rowsFor([FINAL]);
  const thirdPlaceRow = useMemo(
    () => ({
      match: {
        match: THIRD_PLACE_MATCH,
        stage: "third_place",
        a: { kind: "matchWinner", match: 101 },
        b: { kind: "matchWinner", match: 102 },
      } as BracketMatch,
      a: thirdPlaceA,
      b: thirdPlaceB,
      draft: getDraft(THIRD_PLACE_MATCH),
      saved: savedDrafts[THIRD_PLACE_MATCH] ?? EMPTY_DRAFT,
    }),
    [getDraft, savedDrafts, thirdPlaceA, thirdPlaceB],
  );

  const printableRows = useMemo(() => {
    const groupPredByMatch = new Map<string, PredLite>();
    (groupPreds ?? []).forEach((p) => groupPredByMatch.set(p.match_id, p));

    const allMatches = (matchesAll ?? [])
      .slice()
      .sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime());
    const groupMatches = allMatches.filter((m) => m.stage === "group");

    const fallbackGroupNum = new Map<string, number>();
    groupMatches.forEach((m, i) => {
      const parsed = parseMatchNumber(m.external_id);
      if (!parsed) fallbackGroupNum.set(m.id, i + 1);
    });

    const matchNumById = new Map<string, number>();
    const matchesByNum = new Map<number, RawMatch>();

    for (const match of allMatches) {
      const parsed = parseMatchNumber(match.external_id);
      let matchNum = parsed;

      if (match.stage === "group" && (matchNum === null || matchNum < 1 || matchNum > 200)) {
        matchNum = fallbackGroupNum.get(match.id) ?? null;
      }
      if (matchNum === null && match.stage !== "group") {
        matchNum = bestMatchNumFromKickoff(match.kickoff_at);
      }

      if (matchNum != null) {
        matchNumById.set(match.id, matchNum);
        matchesByNum.set(matchNum, match);
      }
    }

    const rows: PrintRow[] = [];

    for (const match of groupMatches) {
      const homeTeam = teamsById.get(match.home_team_id ?? "");
      const awayTeam = teamsById.get(match.away_team_id ?? "");
      const pred = groupPredByMatch.get(match.id);
      rows.push({
        key: match.id,
        matchNum: matchNumById.get(match.id) ?? null,
        kickoffAt: match.kickoff_at,
        home: homeTeam?.name ?? "Equipe A",
        away: awayTeam?.name ?? "Equipe B",
        homePick: pred?.home_score ?? null,
        awayPick: pred?.away_score ?? null,
        winner: null,
        isGroup: true,
      });
    }

    const bracketRows = [
      ...phases.flatMap((phase) => rowsFor(phase.matches)),
      thirdPlaceRow,
      ...finalRows,
    ];

    for (const row of bracketRows) {
      const resolved = matchesByNum.get(row.match.match);
      const kickoffAt = resolved?.kickoff_at ?? "";
      const winnerId = effectiveWinner(row.draft, row.a, row.b);
      const winner = winnerId
        ? (teamsById.get(winnerId)?.name ??
          (row.a.teamId === winnerId ? row.a.teamName : row.b.teamName))
        : null;
      rows.push({
        key: `knockout-${row.match.match}`,
        matchNum: row.match.match,
        kickoffAt,
        home: row.a.teamId ? (row.a.teamName ?? "") : (row.a.placeholder ?? ""),
        away: row.b.teamId ? (row.b.teamName ?? "") : (row.b.placeholder ?? ""),
        homePick: parseScore(row.draft.home),
        awayPick: parseScore(row.draft.away),
        winner,
        isGroup: false,
      });
    }

    const sorted = rows
      .filter((row) => row.matchNum !== null)
      .sort((a, b) => {
        const aTime = new Date(a.kickoffAt).getTime();
        const bTime = new Date(b.kickoffAt).getTime();
        if (Number.isNaN(aTime) || Number.isNaN(bTime))
          return (a.matchNum ?? 0) - (b.matchNum ?? 0);
        if (aTime !== bTime) return aTime - bTime;
        return (a.matchNum ?? 0) - (b.matchNum ?? 0);
      });

    const fallbackSort = rows
      .filter((row) => row.matchNum === null)
      .sort((a, b) => (a.key < b.key ? -1 : 1));

    return [...sorted, ...fallbackSort];
  }, [groupPreds, matchesAll, teamsById, phases, finalRows, thirdPlaceRow, rowsFor]);

  if (
    !user ||
    !teams ||
    !matchesAll ||
    !qualifiers ||
    groupPreds === undefined ||
    brackets === undefined ||
    champ === undefined
  ) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  const groupMatchIds = (matchesAll as MatchLite[])
    .filter((m) => m.stage === "group")
    .map((m) => m.id);
  const predMatchIds = new Set((groupPreds ?? []).map((p) => p.match_id));
  const groupMissing = groupMatchIds.filter((id) => !predMatchIds.has(id)).length;
  const groupComplete = groupMatchIds.length > 0 && groupMissing === 0;

  if (!groupComplete) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-amber-500" />
        <h3 className="mb-2 text-lg font-black uppercase tracking-tight">Chaveamento bloqueado</h3>
        <p className="text-sm text-muted-foreground">
          É necessário completar todos os palpites da{" "}
          <strong className="text-foreground">Fase de Grupos</strong> antes de acessar o
          chaveamento.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Faltam <strong className="text-foreground">{groupMissing}</strong> de{" "}
          {groupMatchIds.length} jogos da fase de grupos.
        </p>
      </div>
    );
  }

  const allRowsStatus = phaseStatus([
    ...phases.flatMap((phase) => rowsFor(phase.matches)),
    thirdPlaceRow,
    ...finalRows,
  ]);

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .bracket-print {
            visibility: visible;
            position: absolute;
            inset: 0;
          }
          .bracket-print * {
            visibility: visible;
            color: black !important;
          }
          .screen-only {
            display: none !important;
          }
          .bracket-print {
            display: block !important;
          }
          .bracket-print table,
          .bracket-print td {
            border-color: #000 !important;
          }
        }
      `}</style>

      <div className="bracket-print hidden">
        <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-foreground">
          Palpites (fase de grupos + chaveamento)
        </h2>
        <table className="w-full table-fixed border-collapse border border-border text-[11px]">
          <tbody>
            {printableRows.map((row) => (
              <tr key={row.key} className="border-b border-border">
                <td className="w-16 border-r border-border px-2 py-1 font-bold tabular-nums">
                  M{row.matchNum ?? "—"}
                </td>
                <td className="w-full truncate border-r border-border px-2 py-1">
                  {row.home} × {row.away}
                </td>
                <td className="w-20 px-2 py-1 text-right tabular-nums">
                  {formatScore(row.homePick)} × {formatScore(row.awayPick)}
                </td>
                <td className="w-28 px-2 py-1 text-muted-foreground">
                  {row.winner ? `Vencedor: ${row.winner}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="screen-only space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-foreground">
              Chaveamento
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Coloque o placar do tempo normal. Em caso de empate, escolha quem avança.
            </p>
          </div>
        </div>

        {locked ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <Lock className="h-4 w-4 text-amber-500" />
            Palpites encerrados em 10/06 às 14:00 (horário de Brasília).
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            Palpites podem ser enviados até{" "}
            <strong className="text-foreground">10/06/2026 às 14:00 (horário de Brasília)</strong>{" "}
            (1 dia antes do primeiro jogo).
          </div>
        )}

        {phases.map((phase) => {
          const rows = rowsFor(phase.matches);
          const status = phaseStatus(rows);
          return (
            <PhaseSection
              key={phase.label}
              label={phase.label}
              saveLabel={phase.saveLabel}
              count={phase.matches.length}
              icon={phase.icon}
              status={status}
              locked={locked}
              saving={savePhase.isPending}
              onSave={() => saveNormalPhase(phase.saveLabel, rows)}
            >
              {rows.map((row) => (
                <EditableMatchRow
                  key={row.match.match}
                  row={row}
                  disabled={locked || savePhase.isPending}
                  onChange={(patch) => updateDraft(row.match.match, patch)}
                />
              ))}
            </PhaseSection>
          );
        })}

        <PhaseSection
          label={`3º colocado (M${THIRD_PLACE_MATCH})`}
          saveLabel="3º colocado"
          count={1}
          icon={<Trophy className="h-4 w-4 text-amber-500" />}
          status={phaseStatus([thirdPlaceRow])}
          locked={locked}
          saving={savePhase.isPending}
          onSave={saveThirdPlace}
        >
          <EditableMatchRow
            row={thirdPlaceRow}
            disabled={locked || savePhase.isPending}
            drawLabel="Empate — quem fica em 3º?"
            onChange={(patch) => updateDraft(THIRD_PLACE_MATCH, patch)}
          />
        </PhaseSection>

        <PhaseSection
          label="Final"
          saveLabel="Final"
          count={1}
          icon={<Crown className="h-4 w-4 text-primary" />}
          status={phaseStatus(finalRows)}
          locked={locked}
          saving={savePhase.isPending}
          onSave={() => saveNormalPhase("Final", finalRows)}
        >
          {finalRows.map((row) => (
            <EditableMatchRow
              key={row.match.match}
              row={row}
              disabled={locked || savePhase.isPending}
              drawLabel="Empate — quem é campeão?"
              onChange={(patch) => updateDraft(row.match.match, patch)}
            />
          ))}
        </PhaseSection>

        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CheckCircle2
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                allRowsStatus.saved ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider">
                {allRowsStatus.saved ? "Palpites salvos e validados" : "Validação dos palpites"}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {allRowsStatus.saved
                  ? "Todos os placares e vencedores do chaveamento estão completos, salvos e prontos para conferência."
                  : "Complete e salve todas as fases para validar seus palpites antes de imprimir."}
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Imprimir palpites
          </Button>
        </div>
      </div>
    </div>
  );
}

function PhaseSection({
  label,
  saveLabel,
  count,
  icon,
  status,
  locked,
  saving,
  onSave,
  children,
}: {
  label: string;
  saveLabel: string;
  count: number;
  icon?: ReactNode;
  status: ReturnType<typeof phaseStatus>;
  locked: boolean;
  saving: boolean;
  onSave: () => void;
  children: ReactNode;
}) {
  const buttonText = status.saved ? "Fase salva" : `Salvar ${saveLabel}`;
  const handleSave = () => {
    try {
      onSave();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar esta fase");
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-5 py-3">
        {icon}
        <h3 className="text-base font-black uppercase tracking-tight">{label}</h3>
        <span className="text-xs text-muted-foreground">
          {count} {count === 1 ? "jogo" : "jogos"}
        </span>
      </header>
      <div className="divide-y divide-border">{children}</div>
      <footer className="flex justify-end border-t border-border bg-muted/20 px-5 py-4">
        <Button
          type="button"
          size="sm"
          disabled={locked || saving || !status.canSave}
          onClick={handleSave}
        >
          <Save className="h-4 w-4" />
          <span>{saving ? "Salvando..." : buttonText}</span>
        </Button>
      </footer>
    </section>
  );
}

function EditableMatchRow({
  row,
  disabled,
  drawLabel = "Empate — quem avança?",
  onChange,
}: {
  row: DraftRow;
  disabled: boolean;
  drawLabel?: string;
  onChange: (patch: Partial<DraftPick>) => void;
}) {
  const home = parseScore(row.draft.home);
  const away = parseScore(row.draft.away);
  const isDraw = home !== null && away !== null && home === away;
  const winnerId = effectiveWinner(row.draft, row.a, row.b);
  const ready = !!row.a.teamId && !!row.b.teamId;

  return (
    <div className="px-3 py-3 sm:px-5">
      <div className="grid grid-cols-[3rem_minmax(0,1fr)_7.25rem_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        <div className="text-xs font-bold text-muted-foreground">M{row.match.match}</div>
        <TeamLabel
          slot={row.a}
          side="home"
          isWinner={winnerId === row.a.teamId && winnerId !== null}
        />
        <div className="flex items-center justify-center gap-1">
          <ScoreInput
            value={row.draft.home}
            disabled={disabled || !ready}
            onChange={(homeValue) => onChange({ home: homeValue })}
          />
          <span className="text-sm font-bold text-muted-foreground">×</span>
          <ScoreInput
            value={row.draft.away}
            disabled={disabled || !ready}
            onChange={(awayValue) => onChange({ away: awayValue })}
          />
        </div>
        <TeamLabel
          slot={row.b}
          side="away"
          isWinner={winnerId === row.b.teamId && winnerId !== null}
        />
      </div>

      {isDraw && ready && (
        <div className="mt-3 grid gap-2 sm:ml-[3.75rem] sm:grid-cols-[10rem_1fr] sm:items-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
            {drawLabel}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={row.draft.winnerId === row.a.teamId ? "default" : "outline"}
              disabled={disabled}
              onClick={() => onChange({ winnerId: row.a.teamId })}
            >
              {row.a.teamName}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={row.draft.winnerId === row.b.teamId ? "default" : "outline"}
              disabled={disabled}
              onClick={() => onChange({ winnerId: row.b.teamId })}
            >
              {row.b.teamName}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamLabel({
  slot,
  side,
  isWinner,
}: {
  slot: ResolvedSlot;
  side: "home" | "away";
  isWinner: boolean;
}) {
  const align = side === "home" ? "justify-end text-right" : "justify-start";
  const name = slot.teamId ? slot.teamName : slot.placeholder;

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${align}`}>
      {side === "away" && isWinner && <Crown className="h-3.5 w-3.5 shrink-0 text-primary" />}
      {side === "away" && slot.teamId && slot.flagUrl && (
        <img src={slot.flagUrl} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" />
      )}
      <span
        className={`truncate text-sm font-semibold ${slot.teamId ? "text-foreground" : "italic text-muted-foreground"}`}
      >
        {name}
      </span>
      {side === "home" && slot.teamId && slot.flagUrl && (
        <img src={slot.flagUrl} alt="" className="h-4 w-6 shrink-0 rounded-sm object-cover" />
      )}
      {side === "home" && isWinner && <Crown className="h-3.5 w-3.5 shrink-0 text-primary" />}
    </div>
  );
}

function ScoreInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      maxLength={2}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ""))}
      className="h-9 w-12 text-center text-sm font-bold"
    />
  );
}

function phaseStatus(rows: DraftRow[]) {
  const allResolved = rows.every((row) => row.a.teamId && row.b.teamId);
  const allComplete = allResolved && rows.every((row) => draftComplete(row.draft, row.a, row.b));
  const dirty = rows.some((row) => !sameDraft(row.draft, row.saved, row.a, row.b));
  const saved = allComplete && !dirty;

  return {
    allResolved,
    allComplete,
    dirty,
    saved,
    canSave: allResolved && allComplete && dirty,
  };
}

function draftComplete(draft: DraftPick, a: ResolvedSlot, b: ResolvedSlot) {
  const home = parseScore(draft.home);
  const away = parseScore(draft.away);
  if (!a.teamId || !b.teamId || home === null || away === null) return false;
  if (home === away) return draft.winnerId === a.teamId || draft.winnerId === b.teamId;
  return true;
}

function sameDraft(current: DraftPick, saved: DraftPick, a: ResolvedSlot, b: ResolvedSlot) {
  return (
    current.home === saved.home &&
    current.away === saved.away &&
    effectiveWinner(current, a, b) === effectiveWinner(saved, a, b)
  );
}

function effectiveWinner(draft: DraftPick, a: ResolvedSlot, b: ResolvedSlot): string | null {
  const home = parseScore(draft.home);
  const away = parseScore(draft.away);
  if (!a.teamId || !b.teamId || home === null || away === null) return null;
  if (home > away) return a.teamId;
  if (away > home) return b.teamId;
  return draft.winnerId === a.teamId || draft.winnerId === b.teamId ? draft.winnerId : null;
}

function parseScore(value: string): number | null {
  return value === "" ? null : Number(value);
}

function scoreToInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function loserFromSemi(
  winnerId: string | null | undefined,
  a: ResolvedSlot,
  b: ResolvedSlot,
  placeholder: string,
): ResolvedSlot {
  if (!winnerId || !a.teamId || !b.teamId) return { teamId: null, teamName: null, placeholder };
  return winnerId === a.teamId ? b : a;
}

function slotFromStoredTeam(
  teamId: string | null | undefined,
  teamsById: Map<string, TeamWithFlag>,
  fallback: ResolvedSlot,
): ResolvedSlot {
  if (!teamId) return fallback;
  const team = teamsById.get(teamId);
  return team ? { teamId: team.id, teamName: team.name, flagUrl: team.flag_url } : fallback;
}
