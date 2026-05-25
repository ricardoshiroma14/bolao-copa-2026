// Sync teams + matches from TheSportsDB for the FIFA World Cup.
// Defaults to TheSportsDB free key and FIFA World Cup league id 4429.
import { createClient } from "npm:@supabase/supabase-js@2";
import { AdminAuthError, requireAdmin } from "../_shared/admin-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const API_BASE = "https://www.thesportsdb.com/api/v1/json";
const API_KEY_ENV = "THESPORTSDB_API_KEY";
const FREE_API_KEY = "123";
const LEAGUE_ID = Deno.env.get("THESPORTSDB_WORLD_CUP_LEAGUE_ID")?.trim() || "4429";
const SEASON = Deno.env.get("THESPORTSDB_WORLD_CUP_SEASON")?.trim() || "2026";
const CRON_SECRET_ENV = "SYNC_CRON_SECRET";

const TEAM_NAME_FIXES: Record<string, string> = {
  "Bosnia and Herzegovina": "Bósnia",
  "Bosnia & Herzegovina": "Bósnia",
  Bosnia: "Bósnia",
};

type TheSportsDbEvent = {
  idEvent: string;
  strTimestamp?: string | null;
  strEvent?: string | null;
  strSeason?: string | null;
  idHomeTeam?: string | null;
  idAwayTeam?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  intRound?: string | number | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strVenue?: string | null;
  strCity?: string | null;
  strStatus?: string | null;
};

type EventEnvelope = {
  events?: TheSportsDbEvent[] | null;
  event?: TheSportsDbEvent[] | null;
};

type ScorePredictionsResult = {
  ok?: boolean;
  error?: string;
  predictions?: number;
  brackets?: number;
  champions?: number;
};

function normalizeTeamName(rawName: string): string {
  return TEAM_NAME_FIXES[rawName] ?? rawName;
}

function teamCode(rawName: string): string {
  return rawName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, "X");
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTime(event: TheSportsDbEvent): string {
  if (event.strTimestamp) {
    const timestamp = event.strTimestamp.endsWith("Z")
      ? event.strTimestamp
      : `${event.strTimestamp}Z`;
    return new Date(timestamp).toISOString();
  }
  if (event.dateEvent && event.strTime)
    return new Date(`${event.dateEvent}T${event.strTime}Z`).toISOString();
  if (event.dateEvent) return new Date(`${event.dateEvent}T00:00:00Z`).toISOString();
  throw new Error(`Evento ${event.idEvent} sem data/hora.`);
}

function mapStage(event: TheSportsDbEvent): { stage: string; group_name: string | null } {
  const text = `${event.intRound ?? ""} ${event.strEvent ?? ""}`.toLowerCase();
  const groupMatch = text.match(/\bgroup\s+([a-l])\b/i);
  if (groupMatch) return { stage: "group", group_name: groupMatch[1].toUpperCase() };
  if (text.includes("round of 32")) return { stage: "round_of_32", group_name: null };
  if (text.includes("round of 16") || text.includes("8th final"))
    return { stage: "round_of_16", group_name: null };
  if (text.includes("quarter")) return { stage: "quarter", group_name: null };
  if (text.includes("semi")) return { stage: "semi", group_name: null };
  if (text.includes("third") || text.includes("3rd"))
    return { stage: "third_place", group_name: null };
  if (text.includes("final")) return { stage: "final", group_name: null };
  return { stage: "group", group_name: null };
}

function mapStatus(status: string | null | undefined): string {
  const code = status ?? "NS";
  if (["NS", "TBD"].includes(code)) return "scheduled";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(code)) return "live";
  if (["FT", "AET", "PEN"].includes(code)) return "finished";
  if (["PST", "SUSP"].includes(code)) return "postponed";
  if (["CANC", "ABD", "AWD", "WO"].includes(code)) return "cancelled";
  return "scheduled";
}

function envelopeEvents(body: EventEnvelope): TheSportsDbEvent[] {
  return body.events ?? body.event ?? [];
}

function isCronRequest(req: Request): boolean {
  const expected = Deno.env.get(CRON_SECRET_ENV);
  const received = req.headers.get("x-cron-secret");
  return Boolean(expected && received && received === expected);
}

async function requireAdminOrCron(req: Request): Promise<"admin" | "cron"> {
  if (isCronRequest(req)) return "cron";
  await requireAdmin(req);
  return "admin";
}

async function sportsDbGet(endpoint: string, apiKey: string): Promise<EventEnvelope> {
  const normalizedEndpoint = endpoint.replace(/^\/+/, "");
  const url = new URL(`${apiKey}/${normalizedEndpoint}`, `${API_BASE}/`);
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`TheSportsDB ${res.status}: ${text}`);
  return JSON.parse(text) as EventEnvelope;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authMode = await requireAdminOrCron(req);

    const apiKey = Deno.env.get(API_KEY_ENV)?.trim() || FREE_API_KEY;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const seasonJson = await sportsDbGet(
      `/eventsseason.php?id=${LEAGUE_ID}&s=${encodeURIComponent(SEASON)}`,
      apiKey,
    );
    const events = envelopeEvents(seasonJson);

    const teamRows = new Map<
      string,
      { external_id: string; name: string; code: string; flag_url: string | null }
    >();
    for (const event of events) {
      const teams = [
        { id: event.idHomeTeam, name: event.strHomeTeam, badge: event.strHomeTeamBadge },
        { id: event.idAwayTeam, name: event.strAwayTeam, badge: event.strAwayTeamBadge },
      ];
      for (const team of teams) {
        if (!team.id || !team.name) continue;
        teamRows.set(team.id, {
          external_id: team.id,
          name: normalizeTeamName(team.name),
          code: teamCode(team.name),
          flag_url: team.badge ?? null,
        });
      }
    }

    const teamPayload = [...teamRows.values()];
    if (teamPayload.length) {
      const { error } = await supabase
        .from("teams")
        .upsert(teamPayload, { onConflict: "external_id" });
      if (error) throw new Error(`teams upsert: ${error.message}`);
    }

    const { error: legacyTeamFixError } = await supabase
      .from("teams")
      .update({ name: "Bósnia" })
      .eq("code", "BIH");
    if (legacyTeamFixError) throw new Error(`teams normalization: ${legacyTeamFixError.message}`);

    const { data: allTeams } = await supabase.from("teams").select("id, external_id");
    const map = new Map((allTeams ?? []).map((t) => [String(t.external_id), t.id]));

    const matchRows = events.map((event) => {
      const { stage, group_name } = mapStage(event);
      return {
        external_id: String(event.idEvent),
        stage,
        group_name,
        home_team_id: event.idHomeTeam ? (map.get(String(event.idHomeTeam)) ?? null) : null,
        away_team_id: event.idAwayTeam ? (map.get(String(event.idAwayTeam)) ?? null) : null,
        kickoff_at: eventTime(event),
        home_score: numberOrNull(event.intHomeScore),
        away_score: numberOrNull(event.intAwayScore),
        status: mapStatus(event.strStatus),
        venue: [event.strVenue, event.strCity].filter(Boolean).join(" - ") || null,
      };
    });

    if (matchRows.length) {
      const { error } = await supabase
        .from("matches")
        .upsert(matchRows, { onConflict: "external_id" });
      if (error) throw new Error(`matches upsert: ${error.message}`);
    }

    const finishedIds = matchRows.filter((m) => m.status === "finished").map((m) => m.external_id);
    const authorization = req.headers.get("authorization") ?? "";
    const scoringAuthorization = authMode === "cron" ? `Bearer ${serviceKey}` : authorization;
    const { data: scoring, error: scoringError } =
      await supabase.functions.invoke<ScorePredictionsResult>("score-predictions", {
        headers: { Authorization: scoringAuthorization },
      });

    if (scoringError) {
      throw new Error(`score-predictions after sync: ${scoringError.message}`);
    }
    if (!scoring?.ok) {
      throw new Error(`score-predictions after sync: ${scoring?.error ?? "unknown error"}`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        authMode,
        provider: "thesportsdb",
        teams: teamPayload.length,
        matches: matchRows.length,
        finished: finishedIds.length,
        scoring: {
          predictions: scoring.predictions ?? 0,
          brackets: scoring.brackets ?? 0,
          champions: scoring.champions ?? 0,
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
