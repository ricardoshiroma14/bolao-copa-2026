import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Save, CheckCircle2, Clock, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  FINAL,
  QF,
  R16,
  R32,
  SF,
  THIRD_PLACE_MATCH,
  type BracketMatch,
  type SlotSpec,
} from "@/lib/wc2026-bracket";
import { BRACKET_SCHEDULE } from "@/lib/wc2026-bracket-schedule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MatchRow = {
  id: string;
  external_id: string | null;
  stage: string;
  group_name: string | null;
  kickoff_at: string;
  venue: string | null;
  status: "scheduled" | "live" | "finished";
  home_score: number | null;
  away_score: number | null;
  home_penalties: number | null;
  away_penalties: number | null;
  winner_team_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team: { name: string; flag_url: string | null } | null;
  away_team: { name: string; flag_url: string | null } | null;
};

type MatchRowWithNumber = MatchRow & { matchNum: number | null };

const MATCH_NUM_RE = /\b(?:M|match[-_ ]?)?(\d{2,3})\b/i;

const STAGE_MATCH_NUMS: Record<string, number[]> = {
  round_of_32: R32.map((m) => m.match),
  round_of_16: R16.map((m) => m.match),
  quarter: QF.map((m) => m.match),
  semi: SF.map((m) => m.match),
  third_place: [THIRD_PLACE_MATCH],
  final: [FINAL.match],
};

function matchNumFromKickoff(kickoff: string, stage: string): number | null {
  const candidates = STAGE_MATCH_NUMS[stage] ?? [];
  if (!candidates.length) return null;

  const target = new Date(kickoff).getTime();
  let bestNum: number | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const num of candidates) {
    const schedule = BRACKET_SCHEDULE[num];
    if (!schedule) continue;
    const diff = Math.abs(new Date(schedule.kickoffISO).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestNum = num;
    }
  }

  return bestDiff <= 3 * 60 * 60 * 1000 ? bestNum : null;
}

function extractMatchNum(match: MatchRow): number | null {
  const parsed = match.external_id?.match(MATCH_NUM_RE);
  if (parsed) {
    const maybe = Number(parsed[1]);
    if (Number.isInteger(maybe) && maybe >= 73 && maybe <= 104) return maybe;
  }
  return match.stage === "group" ? null : matchNumFromKickoff(match.kickoff_at, match.stage);
}

type NextSlot = { matchNum: number; side: "home" | "away" };

const WINNER_TO_NEXT = (() => {
  const map = new Map<number, NextSlot[]>();
  const add = (source: number, target: number, side: "home" | "away") => {
    const list = map.get(source) ?? [];
    list.push({ matchNum: target, side });
    map.set(source, list);
  };

  const allTargets: BracketMatch[] = [...R16, ...QF, ...SF, FINAL];
  for (const match of allTargets) {
    if (match.a.kind === "matchWinner") add(match.a.match, match.match, "home");
    if (match.b.kind === "matchWinner") add(match.b.match, match.match, "away");
  }

  return map;
})();

// Source label for a knockout match: "Vencedor M73 vs Vencedor M75", group letter, etc.
const SOURCE_LABEL: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  const fmt = (s: SlotSpec): string => {
    if (s.kind === "winner") return `1º Grupo ${s.group}`;
    if (s.kind === "runnerUp") return `2º Grupo ${s.group}`;
    if (s.kind === "third") return `3º ${s.groups.join("/")}`;
    return `Vencedor M${s.match}`;
  };
  for (const m of [...R32, ...R16, ...QF, ...SF, FINAL]) {
    map[m.match] = `${fmt(m.a)}  vs  ${fmt(m.b)}`;
  }
  map[THIRD_PLACE_MATCH] = "Perdedor M101  vs  Perdedor M102";
  return map;
})();

function determineThirdPlaceSide(matchNum: number): "home" | "away" | null {
  if (matchNum === 101) return "home";
  if (matchNum === 102) return "away";
  return null;
}

function toMatchMap(matches: MatchRow[]): Map<number, MatchRowWithNumber> {
  const map = new Map<number, MatchRowWithNumber>();
  const unmatchedByStage = new Map<string, MatchRow[]>();

  for (const match of matches) {
    const matchNum = extractMatchNum(match);
    if (matchNum) {
      map.set(matchNum, { ...match, matchNum });
    } else if (STAGE_MATCH_NUMS[match.stage]?.length) {
      const list = unmatchedByStage.get(match.stage) ?? [];
      list.push(match);
      unmatchedByStage.set(match.stage, list);
    }
  }

  for (const [stage, stageMatches] of unmatchedByStage) {
    const stageNums = (STAGE_MATCH_NUMS[stage] ?? [])
      .filter((matchNum) => !map.has(matchNum))
      .sort(
        (a, b) =>
          new Date(BRACKET_SCHEDULE[a].kickoffISO).getTime() -
          new Date(BRACKET_SCHEDULE[b].kickoffISO).getTime(),
      );
    const sortedMatches = [...stageMatches].sort(
      (a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime(),
    );

    sortedMatches.forEach((match, index) => {
      const matchNum = stageNums[index];
      if (matchNum) map.set(matchNum, { ...match, matchNum });
    });
  }

  return map;
}

function matchNumForRow(
  match: MatchRow,
  allMatches: Map<number, MatchRowWithNumber>,
): number | null {
  const direct = extractMatchNum(match);
  if (direct) return direct;
  for (const [matchNum, mappedMatch] of allMatches) {
    if (mappedMatch.id === match.id) return matchNum;
  }
  return null;
}

function buildKnockoutProgressionPatches(
  currentMatch: MatchRowWithNumber,
  winnerId: string | null,
  allMatches: Map<number, MatchRowWithNumber>,
): { id: string; home_team_id: string | null; away_team_id: string | null }[] {
  if (!currentMatch.matchNum || currentMatch.stage === "group" || !winnerId) return [];
  const updates: { id: string; home_team_id: string | null; away_team_id: string | null }[] = [];

  const addPatch = (
    target: MatchRowWithNumber | undefined,
    side: "home" | "away",
    teamId: string | null,
  ) => {
    if (!target) return;
    if (!teamId) return;
    if (side === "home" && target.home_team_id === teamId) return;
    if (side === "away" && target.away_team_id === teamId) return;
    const patch: { id: string; home_team_id: string | null; away_team_id: string | null } = {
      id: target.id,
      home_team_id: null,
      away_team_id: null,
    };
    if (side === "home") patch.home_team_id = teamId;
    else patch.away_team_id = teamId;
    updates.push(patch);
  };

  const winner = winnerId;
  for (const next of WINNER_TO_NEXT.get(currentMatch.matchNum) ?? []) {
    const target = allMatches.get(next.matchNum);
    addPatch(target, next.side, winner);
  }

  if (currentMatch.stage === "semi" && winner) {
    const side = determineThirdPlaceSide(currentMatch.matchNum);
    const loser =
      winner === currentMatch.home_team_id ? currentMatch.away_team_id : currentMatch.home_team_id;
    const third = allMatches.get(THIRD_PLACE_MATCH);
    if (side) addPatch(third, side, loser);
  }

  return updates;
}

const KNOCKOUT_STAGES = new Set([
  "round_of_32",
  "round_of_16",
  "quarter",
  "semi",
  "third_place",
  "final",
]);

const STAGE_LABEL: Record<string, string> = {
  group: "Grupos",
  round_of_32: "Rodada de 32",
  round_of_16: "Oitavas",
  quarter: "Quartas",
  semi: "Semis",
  third_place: "3º lugar",
  final: "Final",
};

export function AdminMatches() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: matches, isLoading } = useQuery({
    queryKey: ["admin-matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "id,external_id,stage,group_name,kickoff_at,venue,status,home_score,away_score," +
            "home_penalties,away_penalties,winner_team_id,home_team_id,away_team_id," +
            "home_team:teams!matches_home_team_id_fkey(name,flag_url)," +
            "away_team:teams!matches_away_team_id_fkey(name,flag_url)",
        )
        .order("kickoff_at", { ascending: true });
      if (error) throw error;
      return data as unknown as MatchRow[];
    },
  });

  const matchesByNumber = useMemo(() => toMatchMap(matches ?? []), [matches]);

  const filtered = useMemo(() => {
    if (!matches) return [];
    return matches.filter((m) => {
      if (filter !== "all" && m.stage !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchNum = matchNumForRow(m, matchesByNumber);
        const txt =
          `${m.home_team?.name ?? ""} ${m.away_team?.name ?? ""} ${m.group_name ?? ""} ${m.venue ?? ""} ${matchNum ? `jogo ${matchNum} m${matchNum}` : ""}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }, [matches, filter, search, matchesByNumber]);

  const stages = [
    "all",
    "group",
    "round_of_32",
    "round_of_16",
    "quarter",
    "semi",
    "third_place",
    "final",
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="mb-1 text-lg font-bold">Jogos e resultados</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Controle de placares oficiais. Edite o resultado e marque como encerrado quando o jogo
        terminar.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          placeholder="Buscar país, grupo, estádio ou jogo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex flex-wrap gap-1">
          {stages.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? "default" : "outline"}
              onClick={() => setFilter(s)}
            >
              {s === "all" ? "Todos" : (STAGE_LABEL[s] ?? s)}
            </Button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum jogo encontrado.</p>
      )}

      <div className="space-y-2">
        {filtered.map((m) => (
          <MatchRowEditor
            key={m.id}
            match={m}
            matchByNumber={matchesByNumber}
            onSaved={() => qc.invalidateQueries({ queryKey: ["admin-matches"] })}
          />
        ))}
      </div>
    </div>
  );
}

function MatchRowEditor({
  match,
  matchByNumber,
  onSaved,
}: {
  match: MatchRow;
  matchByNumber: Map<number, MatchRowWithNumber>;
  onSaved: () => void;
}) {
  const [home, setHome] = useState<string>(match.home_score?.toString() ?? "");
  const [away, setAway] = useState<string>(match.away_score?.toString() ?? "");
  const [homePen, setHomePen] = useState<string>(match.home_penalties?.toString() ?? "");
  const [awayPen, setAwayPen] = useState<string>(match.away_penalties?.toString() ?? "");
  const [winnerId, setWinnerId] = useState<string | null>(match.winner_team_id);
  const [status, setStatus] = useState<MatchRow["status"]>(match.status);
  const [saving, setSaving] = useState(false);

  const kickoff = new Date(match.kickoff_at);
  const started = kickoff <= new Date();
  const displayMatchNum = matchNumForRow(match, matchByNumber);

  const isKnockout = KNOCKOUT_STAGES.has(match.stage);
  const hNum = home === "" ? null : Number(home);
  const aNum = away === "" ? null : Number(away);
  const hPenNum = homePen === "" ? null : Number(homePen);
  const aPenNum = awayPen === "" ? null : Number(awayPen);
  const isDraw = isKnockout && hNum !== null && aNum !== null && hNum === aNum;

  // Auto-derive winner from regular score in knockout when not a draw.
  const autoWinnerId =
    isKnockout && hNum !== null && aNum !== null && hNum !== aNum
      ? hNum > aNum
        ? match.home_team_id
        : match.away_team_id
      : null;
  // Or from penalties if a draw.
  const penWinnerId =
    isDraw && hPenNum !== null && aPenNum !== null && hPenNum !== aPenNum
      ? hPenNum > aPenNum
        ? match.home_team_id
        : match.away_team_id
      : null;
  const effectiveWinnerId = autoWinnerId ?? penWinnerId ?? winnerId;

  const dirty =
    hNum !== match.home_score ||
    aNum !== match.away_score ||
    hPenNum !== match.home_penalties ||
    aPenNum !== match.away_penalties ||
    effectiveWinnerId !== match.winner_team_id ||
    status !== match.status;

  const needsManualWinner = isDraw && !penWinnerId;
  const canSave = dirty && !saving && (!isKnockout || !isDraw || !!effectiveWinnerId);

  const save = async () => {
    setSaving(true);
    const winner = effectiveWinnerId;
    const { error } = await supabase
      .from("matches")
      .update({
        status,
        home_score: hNum,
        away_score: aNum,
        home_penalties: isKnockout ? hPenNum : null,
        away_penalties: isKnockout ? aPenNum : null,
        winner_team_id: isKnockout ? effectiveWinnerId : null,
      })
      .eq("id", match.id);
    if (error) {
      setSaving(false);
      return toast.error(error.message);
    }

    const matchWithNumber: MatchRowWithNumber = {
      ...match,
      matchNum: displayMatchNum,
      winner_team_id: winner,
    };
    const winnerTeamId = winner && status === "finished" ? winner : null;

    if (winnerTeamId) {
      const patches = buildKnockoutProgressionPatches(matchWithNumber, winnerTeamId, matchByNumber);
      for (const patch of patches) {
        const update: { home_team_id?: string | null; away_team_id?: string | null } = {};
        if (patch.home_team_id !== null) update.home_team_id = patch.home_team_id;
        if (patch.away_team_id !== null) update.away_team_id = patch.away_team_id;

        const changed = Object.keys(update).length > 0;
        if (changed) {
          const { error: upErr } = await supabase.from("matches").update(update).eq("id", patch.id);
          if (upErr) {
            setSaving(false);
            return toast.warning(
              `Partida ${patch.id.slice(0, 8)} atualizada em parte: ${upErr.message}`,
            );
          }
        }
      }
    }

    // Recalcula pontos automaticamente para que o ranking reflita o novo resultado.
    const { error: scoreErr } = await supabase.functions.invoke("score-predictions");
    setSaving(false);
    if (scoreErr) {
      toast.warning("Jogo salvo, mas falhou ao recalcular pontos: " + scoreErr.message);
    } else {
      toast.success("Jogo atualizado e pontuação recalculada");
    }
    onSaved();
  };

  const StatusIcon = status === "finished" ? CheckCircle2 : started ? Lock : Clock;

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          {displayMatchNum && (
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-bold text-primary">
              Jogo {displayMatchNum}
            </span>
          )}
          <span className="font-semibold">
            {STAGE_LABEL[match.stage] ?? match.stage}
            {match.group_name ? ` · Grupo ${match.group_name}` : ""}
            {" · "}
            {format(kickoff, "dd/MM 'às' HH:mm", { locale: ptBR })}
          </span>
        </div>
        <span className="flex items-center gap-1">
          <StatusIcon className="h-3 w-3" />
          {status === "finished" ? "Encerrado" : status === "live" ? "Ao vivo" : "Agendado"}
        </span>
      </div>
      {displayMatchNum && SOURCE_LABEL[displayMatchNum] && (
        <div className="mb-2 text-xs text-muted-foreground italic">
          {SOURCE_LABEL[displayMatchNum]}
        </div>
      )}
      {match.venue && <div className="mb-2 text-xs text-muted-foreground">{match.venue}</div>}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-2 justify-end text-right">
          {match.home_team?.flag_url && (
            <img
              src={match.home_team.flag_url}
              alt=""
              className="h-5 w-7 rounded-sm object-cover"
            />
          )}
          <span className="text-sm font-semibold">{match.home_team?.name ?? "—"}</span>
        </div>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            value={home}
            onChange={(e) => setHome(e.target.value)}
            className="h-8 w-14 text-center tabular-nums"
          />
          <span className="text-muted-foreground">×</span>
          <Input
            type="number"
            min={0}
            value={away}
            onChange={(e) => setAway(e.target.value)}
            className="h-8 w-14 text-center tabular-nums"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{match.away_team?.name ?? "—"}</span>
          {match.away_team?.flag_url && (
            <img
              src={match.away_team.flag_url}
              alt=""
              className="h-5 w-7 rounded-sm object-cover"
            />
          )}
        </div>
      </div>

      {isKnockout && isDraw && (
        <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-2.5 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            Empate — defina quem avança
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Pênaltis (opcional):</span>
            <Input
              type="number"
              min={0}
              value={homePen}
              onChange={(e) => setHomePen(e.target.value)}
              className="h-7 w-12 text-center tabular-nums"
              placeholder="—"
            />
            <span className="text-muted-foreground">×</span>
            <Input
              type="number"
              min={0}
              value={awayPen}
              onChange={(e) => setAwayPen(e.target.value)}
              className="h-7 w-12 text-center tabular-nums"
              placeholder="—"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Avança:</span>
            <Button
              type="button"
              size="sm"
              variant={effectiveWinnerId === match.home_team_id ? "default" : "outline"}
              onClick={() => setWinnerId(match.home_team_id)}
              disabled={!!penWinnerId}
              className="h-7"
            >
              {match.home_team?.name ?? "Casa"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={effectiveWinnerId === match.away_team_id ? "default" : "outline"}
              onClick={() => setWinnerId(match.away_team_id)}
              disabled={!!penWinnerId}
              className="h-7"
            >
              {match.away_team?.name ?? "Fora"}
            </Button>
            {penWinnerId && (
              <span className="text-muted-foreground">(definido pelos pênaltis)</span>
            )}
          </div>

          {needsManualWinner && (
            <div className="text-xs text-amber-500">
              Informe o placar dos pênaltis ou escolha o time que avança.
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as MatchRow["status"])}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="scheduled">Agendado</option>
          <option value="live">Ao vivo</option>
          <option value="finished">Encerrado</option>
        </select>
        <Button size="sm" onClick={save} disabled={!canSave}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
