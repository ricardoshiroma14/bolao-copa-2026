import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, SearchCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { invokeAdminFunction } from "@/lib/invoke-admin-function";

type MatchStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";
type SyncPhase = "scheduled" | "in_progress" | "finished";

const TRACKED_FIXTURE_KEY = "thesportsdb-corinthians-fixture-id";
const PRIMARY_FUNCTION = "thesportsdb-fixture-test";
const THESPORTSDB_FREE_TIER_LAG_NOTE = "Free tier pode atrasar status/resultados em 30-45 min";
const STALE_LIVE_FINISH_AFTER_MINUTES = 120;
const LIVE_STATUS_CODES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"]);

type TheSportsDbFixtureResult = {
  ok?: boolean;
  error?: string;
  provider?: "thesportsdb";
  target?: {
    country: string;
    league: string;
    season: number;
    homeOrAway: string;
  };
  resolved?: {
    league: {
      id: number;
      name: string;
      country: string;
      season: number;
    };
    corinthians: {
      id: number | null;
      name: string | null;
    };
    atleticoMineiro: {
      id: number | null;
      name: string | null;
    };
  };
  fixture?: {
    id: number;
    date: string;
    timestamp: number;
    timezone: string;
    status: {
      short: string;
      long: string;
      elapsed: number | null;
    };
    league: {
      id: number;
      name: string;
      country: string;
      season: number;
      round: string;
    };
    teams: {
      home: {
        id: number;
        name: string;
        logo?: string;
        winner: boolean | null;
      };
      away: {
        id: number;
        name: string;
        logo?: string;
        winner: boolean | null;
      };
    };
    venue: {
      name: string | null;
      city: string | null;
    };
    goals: {
      home: number | null;
      away: number | null;
    };
  };
  mappingPreview?: {
    external_id: string;
    kickoff_at: string;
    status: MatchStatus;
    venue: string | null;
    home_team_external_id: string;
    away_team_external_id: string;
    stage_note: string;
  };
  syncSimulation?: {
    phase: SyncPhase;
    label: "Agendado" | "Em andamento" | "Encerrado";
    started: boolean;
    terminal: boolean;
    pollIntervalMinutes: number;
    nextPollAt: string | null;
    stopReason: string | null;
    rule: string;
    officialScore: {
      home: number | null;
      away: number | null;
    };
  };
  rateLimit?: Record<string, string | null>;
};

function formatDate(value: string | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function formatKickoff(value: string | undefined): string {
  if (!value) return "Data pendente";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  })
    .format(new Date(value))
    .replace(",", " às");
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/50 p-3">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-semibold">{value || "-"}</dd>
    </div>
  );
}

function TeamLogo({ src, name }: { src?: string; name: string }) {
  if (!src) {
    return (
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-xs font-black text-muted-foreground">
        {name.slice(0, 3).toUpperCase()}
      </span>
    );
  }

  return (
    <img src={src} alt={name} className="h-10 w-10 rounded-md object-contain" loading="lazy" />
  );
}

function effectiveSyncSimulation(
  result: TheSportsDbFixtureResult | null,
): TheSportsDbFixtureResult["syncSimulation"] {
  const simulation = result?.syncSimulation;
  const fixture = result?.fixture;
  if (!simulation || !fixture || simulation.terminal || simulation.phase !== "in_progress") {
    return simulation;
  }

  const score = simulation.officialScore ?? fixture.goals;
  const hasScore = score.home != null && score.away != null;
  const kickoff = new Date(fixture.date).getTime();
  const elapsedMinutes = (Date.now() - kickoff) / 60_000;
  const staleLiveStatus = LIVE_STATUS_CODES.has(fixture.status.short);

  if (!hasScore || !staleLiveStatus || elapsedMinutes < STALE_LIVE_FINISH_AFTER_MINUTES) {
    return simulation;
  }

  return {
    ...simulation,
    phase: "finished",
    label: "Encerrado",
    terminal: true,
    nextPollAt: null,
    stopReason:
      "Encerrado localmente porque o free tier da TheSportsDB pode atrasar 30-45 min e a API ainda retornou status ao vivo após a janela esperada.",
  };
}

export function TheSportsDbFixtureTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TheSportsDbFixtureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLookupRef = useRef(false);

  const readStoredFixtureId = useCallback(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(TRACKED_FIXTURE_KEY);
    const parsed = Number(stored);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, []);

  const runLookup = useCallback(
    async (options: { fixtureId?: number | null; fresh?: boolean; silent?: boolean } = {}) => {
      const fixtureId = options.fixtureId ?? (options.fresh ? null : readStoredFixtureId());

      setLoading(true);
      setError(null);

      const body = fixtureId ? { fixtureId } : undefined;
      const { data, error: fnError } = await invokeAdminFunction<TheSportsDbFixtureResult>(
        PRIMARY_FUNCTION,
        body,
      );

      setLoading(false);

      if (fnError) {
        setError(fnError.message);
        if (!options.silent) toast.error(fnError.message);
        return;
      }

      if (!data?.ok || !data.fixture || !data.mappingPreview) {
        const message = data?.error ?? "TheSportsDB não retornou uma partida.";
        setError(message);
        if (!options.silent) toast.warning(message);
        return;
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(TRACKED_FIXTURE_KEY, String(data.fixture.id));
      }
      setResult(data);
      if (!options.silent) toast.success("Simulação de sincronização atualizada");
    },
    [readStoredFixtureId],
  );

  const resetTrackedFixture = () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(TRACKED_FIXTURE_KEY);
    setResult(null);
    setError(null);
    toast.info("Fixture salvo removido. A próxima busca será uma nova partida.");
  };

  useEffect(() => {
    if (initialLookupRef.current) return;
    initialLookupRef.current = true;
    void runLookup({ silent: true });
  }, [runLookup]);

  const fixture = result?.fixture;
  const mappingPreview = result?.mappingPreview;
  const syncSimulation = effectiveSyncSimulation(result);

  useEffect(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);

    const fixtureId = result?.fixture?.id;
    const nextPollAt = result?.syncSimulation?.nextPollAt;
    const terminal = result?.syncSimulation?.terminal;
    if (!fixtureId || !nextPollAt || terminal) return;

    const delay = Math.max(0, new Date(nextPollAt).getTime() - Date.now());
    pollTimerRef.current = setTimeout(
      () => void runLookup({ fixtureId, silent: true }),
      Math.min(delay, 2_147_483_647),
    );

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [
    result?.fixture?.id,
    result?.syncSimulation?.nextPollAt,
    result?.syncSimulation?.terminal,
    runLookup,
  ]);

  const quotaRemaining =
    result?.rateLimit?.["x-ratelimit-requests-remaining"] ??
    result?.rateLimit?.["x-ratelimit-remaining"] ??
    "-";
  const score = syncSimulation?.officialScore ?? fixture?.goals;
  const phase = syncSimulation?.phase ?? "scheduled";
  const phaseLabel = syncSimulation?.label ?? (loading ? "Carregando" : "Agendado");
  const phaseClass =
    phase === "finished"
      ? "text-muted-foreground"
      : phase === "in_progress"
        ? "text-orange-300"
        : "text-muted-foreground";
  const venue = [fixture?.venue.name, fixture?.venue.city].filter(Boolean).join(", ");
  const leagueLine = fixture
    ? `${fixture.league.name} · ${fixture.league.round} · ${formatKickoff(fixture.date)}`
    : "Brasileiro Serie A · Corinthians x Atlético Mineiro";
  const nextPollText = syncSimulation?.terminal
    ? "Atualização automática encerrada"
    : syncSimulation?.nextPollAt
      ? `Próxima atualização automática: ${formatDate(syncSimulation.nextPollAt)}`
      : "A atualização automática será armada quando o fixture carregar";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-5">
        <div>
          <h3 className="text-lg font-bold">Teste TheSportsDB</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Simulação do fluxo por jogo que usaremos na Copa: o fixture fica agendado até o kickoff,
            começa a consultar automaticamente no horário inicial e repete a cada 15 minutos até a
            API retornar encerrado.
          </p>
        </div>
        <div className="rounded-md border border-border bg-background/60 px-3 py-2 text-xs font-bold text-muted-foreground">
          THESPORTSDB_API_KEY ou free key 123 · {THESPORTSDB_FREE_TIER_LAG_NOTE}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-muted-foreground">{leagueLine}</p>
            <p className="mt-2 text-sm font-semibold text-muted-foreground">
              {venue || "Estádio não informado pelo TheSportsDB"}
            </p>
          </div>
          <div className={`flex items-center gap-2 text-sm font-bold ${phaseClass}`}>
            <CheckCircle2 className="h-4 w-4" />
            {phaseLabel}
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center justify-center gap-4 md:flex-row md:gap-6">
          <div className="flex min-w-0 items-center gap-3 md:w-1/3 md:justify-end">
            <TeamLogo src={fixture?.teams.home.logo} name={fixture?.teams.home.name ?? "Casa"} />
            <span className="truncate text-xl font-black text-foreground">
              {fixture?.teams.home.name ?? "Corinthians"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-16 w-20 items-center justify-center rounded-xl border border-border bg-background text-3xl font-black">
              {score?.home ?? "-"}
            </div>
            <span className="text-2xl font-black text-muted-foreground">x</span>
            <div className="flex h-16 w-20 items-center justify-center rounded-xl border border-border bg-background text-3xl font-black">
              {score?.away ?? "-"}
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3 md:w-1/3">
            <span className="truncate text-xl font-black text-foreground">
              {fixture?.teams.away.name ?? "Atlético Mineiro"}
            </span>
            <TeamLogo src={fixture?.teams.away.logo} name={fixture?.teams.away.name ?? "Fora"} />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <select
            value={phase}
            disabled
            className="h-12 rounded-lg border border-border bg-background px-4 text-sm font-bold text-foreground disabled:opacity-100"
          >
            <option value="scheduled">Agendado</option>
            <option value="in_progress">Em andamento</option>
            <option value="finished">Encerrado</option>
          </select>

          <Button onClick={() => void runLookup()} disabled={loading} variant="secondary">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Atualizando" : "Atualizar agora"}
          </Button>

          <Button
            onClick={() => void runLookup({ fresh: true })}
            disabled={loading}
            variant="outline"
          >
            <SearchCheck className="mr-2 h-4 w-4" />
            Buscar fixture
          </Button>

          <Button onClick={resetTrackedFixture} disabled={loading} variant="ghost">
            <Trash2 className="mr-2 h-4 w-4" />
            Limpar fixture salvo
          </Button>
        </div>

        <p className="mt-4 text-sm font-semibold text-muted-foreground">{nextPollText}</p>

        {error && (
          <div className="mt-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {fixture && mappingPreview && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Diagnóstico da sincronização
          </h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Fixture ID" value={fixture.id} />
            <Field label="Status API" value={`${fixture.status.short} - ${fixture.status.long}`} />
            <Field label="Quota restante" value={quotaRemaining} />
            <Field
              label="Frequência"
              value={
                syncSimulation?.terminal
                  ? "Sem polling"
                  : `${syncSimulation?.pollIntervalMinutes ?? 15} min após o início`
              }
            />
          </div>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-background/60 p-3 text-xs">
            {JSON.stringify(mappingPreview, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
