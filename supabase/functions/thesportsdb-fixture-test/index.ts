import { AdminAuthError, requireAdmin } from "../_shared/admin-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_BASE_URL = "https://www.thesportsdb.com/api/v1/json";
const API_KEY_ENV = "THESPORTSDB_API_KEY";
const FREE_API_KEY = "123";
const LEAGUE_ID = "4351";
const TARGET_DATE = "2026-05-24";
const POLL_INTERVAL_MINUTES = 15;

type TheSportsDbEvent = {
  idEvent: string;
  idAPIfootball?: string | null;
  strTimestamp?: string | null;
  strEvent?: string | null;
  strSport?: string | null;
  idLeague?: string | null;
  strLeague?: string | null;
  strSeason?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  intRound?: string | number | null;
  dateEvent?: string | null;
  dateEventLocal?: string | null;
  strTime?: string | null;
  strTimeLocal?: string | null;
  idHomeTeam?: string | null;
  idAwayTeam?: string | null;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
  idVenue?: string | null;
  strVenue?: string | null;
  strCountry?: string | null;
  strCity?: string | null;
  strStatus?: string | null;
  strPostponed?: string | null;
};

type EventEnvelope = {
  events?: TheSportsDbEvent[] | null;
  event?: TheSportsDbEvent[] | null;
};

type MatchStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";
type SyncPhase = "scheduled" | "in_progress" | "finished";

type SyncSimulation = {
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

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTime(event: TheSportsDbEvent): Date {
  const timestamp = event.strTimestamp;
  if (timestamp) return new Date(timestamp.endsWith("Z") ? timestamp : `${timestamp}Z`);
  if (event.dateEvent && event.strTime) return new Date(`${event.dateEvent}T${event.strTime}Z`);
  if (event.dateEvent) return new Date(`${event.dateEvent}T00:00:00Z`);
  throw new Error(`Evento ${event.idEvent} sem data/hora.`);
}

async function sportsDbGet(endpoint: string, apiKey: string): Promise<EventEnvelope> {
  const normalizedEndpoint = endpoint.replace(/^\/+/, "");
  const url = new URL(`${apiKey}/${normalizedEndpoint}`, `${API_BASE_URL}/`);
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`TheSportsDB ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text) as EventEnvelope;
  } catch {
    throw new Error(`TheSportsDB retornou JSON inválido: ${text}`);
  }
}

function envelopeEvents(body: EventEnvelope): TheSportsDbEvent[] {
  return body.events ?? body.event ?? [];
}

function mapSportsDbStatus(status: string | null | undefined): MatchStatus {
  const code = status ?? "NS";
  if (["NS", "TBD"].includes(code)) return "scheduled";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(code)) return "live";
  if (["FT", "AET", "PEN"].includes(code)) return "finished";
  if (["PST", "SUSP"].includes(code)) return "postponed";
  if (["CANC", "ABD", "AWD", "WO"].includes(code)) return "cancelled";
  return "scheduled";
}

function isLiveStatus(status: string | null | undefined): boolean {
  return ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(status ?? "");
}

function isTerminalStatus(status: string | null | undefined): boolean {
  return ["FT", "AET", "PEN", "CANC", "ABD", "AWD", "WO", "PST", "SUSP"].includes(status ?? "");
}

function formatStatusLong(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    NS: "Agendado",
    TBD: "Agendado",
    "1H": "Primeiro tempo",
    HT: "Intervalo",
    "2H": "Segundo tempo",
    ET: "Prorrogação",
    BT: "Intervalo da prorrogação",
    P: "Pênaltis",
    LIVE: "Em andamento",
    INT: "Interrompido",
    FT: "Encerrado",
    AET: "Encerrado após prorrogação",
    PEN: "Encerrado nos pênaltis",
    PST: "Adiado",
    SUSP: "Suspenso",
    CANC: "Cancelado",
    ABD: "Abandonado",
    AWD: "Decisão administrativa",
    WO: "W.O.",
  };
  return labels[status ?? "NS"] ?? status ?? "Agendado";
}

function isTargetMatch(event: TheSportsDbEvent): boolean {
  const haystack = normalizeName(
    `${event.strEvent ?? ""} ${event.strHomeTeam ?? ""} ${event.strAwayTeam ?? ""}`,
  );
  return haystack.includes("corinthians") && haystack.includes("atletico mineiro");
}

function buildSyncSimulation(event: TheSportsDbEvent): SyncSimulation {
  const now = Date.now();
  const kickoff = eventTime(event).getTime();
  const status = event.strStatus ?? "NS";
  const live = isLiveStatus(status);
  const terminal = isTerminalStatus(status);
  const started = live || terminal || now >= kickoff;
  const phase: SyncPhase = terminal ? "finished" : started ? "in_progress" : "scheduled";
  const label =
    phase === "finished" ? "Encerrado" : phase === "in_progress" ? "Em andamento" : "Agendado";
  const nextPollAt = terminal
    ? null
    : new Date(started ? now + POLL_INTERVAL_MINUTES * 60 * 1000 : kickoff).toISOString();

  return {
    phase,
    label,
    started,
    terminal,
    pollIntervalMinutes: POLL_INTERVAL_MINUTES,
    nextPollAt,
    stopReason: terminal ? `Parado porque TheSportsDB retornou ${status}.` : null,
    rule: "Antes do kickoff fica agendado; apos o kickoff consulta a cada 15 minutos; para quando o status for final.",
    officialScore: {
      home: numberOrNull(event.intHomeScore),
      away: numberOrNull(event.intAwayScore),
    },
  };
}

function pickTrackedEvent(events: TheSportsDbEvent[]): TheSportsDbEvent {
  const now = Date.now();
  const live = events
    .filter((event) => isLiveStatus(event.strStatus))
    .sort((a, b) => eventTime(a).getTime() - eventTime(b).getTime())[0];
  if (live) return live;

  const activeOrUpcoming = events
    .filter((event) => !isTerminalStatus(event.strStatus))
    .filter((event) => eventTime(event).getTime() >= now - 3 * 60 * 60 * 1000)
    .sort((a, b) => eventTime(a).getTime() - eventTime(b).getTime())[0];
  if (activeOrUpcoming) return activeOrUpcoming;

  const mostRecentFinished = events
    .filter((event) => isTerminalStatus(event.strStatus))
    .sort((a, b) => eventTime(b).getTime() - eventTime(a).getTime())[0];
  if (mostRecentFinished) return mostRecentFinished;

  throw new Error("Nenhuma partida Corinthians x Atletico Mineiro encontrada para rastrear.");
}

async function readRequestedFixtureId(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("fixtureId");
  if (fromQuery) return fromQuery;

  try {
    const body = (await req.clone().json()) as { fixtureId?: unknown };
    return body?.fixtureId ? String(body.fixtureId) : null;
  } catch {
    return null;
  }
}

async function findTargetEvent(apiKey: string): Promise<TheSportsDbEvent> {
  const responses = await Promise.all([
    sportsDbGet(`eventsnextleague.php?id=${LEAGUE_ID}`, apiKey),
    sportsDbGet(`eventsday.php?d=${TARGET_DATE}&l=${LEAGUE_ID}`, apiKey),
    sportsDbGet("searchevents.php?e=Corinthians_vs_Atletico_Mineiro", apiKey),
  ]);

  const seen = new Set<string>();
  const candidates = responses
    .flatMap(envelopeEvents)
    .filter(isTargetMatch)
    .filter((event) => {
      if (seen.has(event.idEvent)) return false;
      seen.add(event.idEvent);
      return true;
    });

  if (!candidates.length) {
    throw new Error(
      `Nenhuma partida Corinthians x Atletico Mineiro encontrada no TheSportsDB para league ${LEAGUE_ID} na data ${TARGET_DATE}.`,
    );
  }

  return pickTrackedEvent(candidates);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireAdmin(req);

    const apiKey = Deno.env.get(API_KEY_ENV)?.trim() || FREE_API_KEY;
    const requestedFixtureId = await readRequestedFixtureId(req);
    let event: TheSportsDbEvent;

    if (requestedFixtureId) {
      const matchResult = await sportsDbGet(`lookupevent.php?id=${requestedFixtureId}`, apiKey);
      const trackedEvent = envelopeEvents(matchResult)[0];
      if (!trackedEvent)
        throw new Error(`Evento ${requestedFixtureId} não encontrado no TheSportsDB.`);
      event = trackedEvent;
    } else {
      event = await findTargetEvent(apiKey);
    }

    if (!isTargetMatch(event)) {
      throw new Error(`Evento ${event.idEvent} não é Corinthians x Atletico Mineiro.`);
    }

    const kickoff = eventTime(event);
    const syncSimulation = buildSyncSimulation(event);
    const venue = [event.strVenue, event.strCity].filter(Boolean).join(" - ") || null;
    const homeId = numberOrNull(event.idHomeTeam);
    const awayId = numberOrNull(event.idAwayTeam);
    const leagueId = numberOrNull(event.idLeague) ?? Number(LEAGUE_ID);

    return new Response(
      JSON.stringify({
        ok: true,
        provider: "thesportsdb",
        target: {
          country: "Brazil",
          league: event.strLeague ?? "Brazilian Serie A",
          season: numberOrNull(event.strSeason) ?? kickoff.getUTCFullYear(),
          homeOrAway: "Corinthians vs Atletico Mineiro",
        },
        resolved: {
          league: {
            id: leagueId,
            name: event.strLeague ?? "Brazilian Serie A",
            country: event.strCountry ?? "Brazil",
            season: numberOrNull(event.strSeason) ?? kickoff.getUTCFullYear(),
          },
          corinthians: {
            id: normalizeName(event.strHomeTeam ?? "").includes("corinthians") ? homeId : awayId,
            name:
              [event.strHomeTeam, event.strAwayTeam].find((team) =>
                normalizeName(team ?? "").includes("corinthians"),
              ) ?? null,
          },
          atleticoMineiro: {
            id: normalizeName(event.strHomeTeam ?? "").includes("atletico mineiro")
              ? homeId
              : awayId,
            name:
              [event.strHomeTeam, event.strAwayTeam].find((team) =>
                normalizeName(team ?? "").includes("atletico mineiro"),
              ) ?? null,
          },
        },
        fixture: {
          id: Number(event.idEvent),
          date: kickoff.toISOString(),
          timestamp: Math.floor(kickoff.getTime() / 1000),
          timezone: "UTC",
          status: {
            short: event.strStatus ?? "NS",
            long: formatStatusLong(event.strStatus),
            elapsed: null,
          },
          league: {
            id: leagueId,
            name: event.strLeague ?? "Brazilian Serie A",
            country: event.strCountry ?? "Brazil",
            season: numberOrNull(event.strSeason) ?? kickoff.getUTCFullYear(),
            round: event.intRound ? `Rodada ${event.intRound}` : "Temporada ativa",
          },
          teams: {
            home: {
              id: homeId ?? 0,
              name: event.strHomeTeam ?? "Casa",
              logo: event.strHomeTeamBadge ?? undefined,
              winner: null,
            },
            away: {
              id: awayId ?? 0,
              name: event.strAwayTeam ?? "Fora",
              logo: event.strAwayTeamBadge ?? undefined,
              winner: null,
            },
          },
          venue: {
            name: event.strVenue ?? null,
            city: event.strCity ?? null,
          },
          goals: {
            home: numberOrNull(event.intHomeScore),
            away: numberOrNull(event.intAwayScore),
          },
          score: null,
        },
        mappingPreview: {
          external_id: `thesportsdb:${event.idEvent}`,
          kickoff_at: kickoff.toISOString(),
          status: mapSportsDbStatus(event.strStatus),
          venue,
          home_team_external_id: `thesportsdb:${event.idHomeTeam}`,
          away_team_external_id: `thesportsdb:${event.idAwayTeam}`,
          stage_note:
            "Brazilian Serie A does not map cleanly to the current World Cup match_stage enum; preview only.",
        },
        syncSimulation,
        rateLimit: {
          provider: "free-api-key-123",
          leagueId: LEAGUE_ID,
          targetDate: TARGET_DATE,
          sourceEventId: event.idEvent,
          sourceProviderLegacyId: event.idAPIfootball ?? null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown error";
    if (e instanceof AdminAuthError) {
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: e.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
