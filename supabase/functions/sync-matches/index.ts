// Sync teams + matches from football-data.org for World Cup
// Requires FOOTBALL_API_KEY secret. Competition: WC (World Cup).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COMPETITION = "WC"; // football-data.org code for FIFA World Cup

type FootballDataTeam = {
  id: number | string;
  name: string;
  tla?: string | null;
  shortName?: string | null;
  crest?: string | null;
};

type FootballDataMatch = {
  id: number | string;
  stage: string;
  group?: string | null;
  utcDate: string;
  status: string;
  venue?: string | null;
  homeTeam?: { id?: number | string | null };
  awayTeam?: { id?: number | string | null };
  score?: {
    fullTime?: {
      home?: number | null;
      away?: number | null;
    };
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("FOOTBALL_API_KEY");
    if (!apiKey) throw new Error("FOOTBALL_API_KEY não configurada");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Fetch teams
    const teamsRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION}/teams`,
      {
        headers: { "X-Auth-Token": apiKey },
      },
    );
    if (!teamsRes.ok) throw new Error(`Teams API ${teamsRes.status}: ${await teamsRes.text()}`);
    const teamsData = (await teamsRes.json()) as { teams?: FootballDataTeam[] };

    const teamRows = (teamsData.teams ?? []).map((t) => ({
      external_id: String(t.id),
      name: t.name,
      code: t.tla ?? t.shortName ?? t.name.slice(0, 3).toUpperCase(),
      flag_url: t.crest,
    }));
    if (teamRows.length) {
      const { error } = await supabase
        .from("teams")
        .upsert(teamRows, { onConflict: "external_id" });
      if (error) throw new Error(`teams upsert: ${error.message}`);
    }

    // Map external -> internal id
    const { data: allTeams } = await supabase.from("teams").select("id, external_id");
    const map = new Map((allTeams ?? []).map((t) => [t.external_id, t.id]));

    // 2. Fetch matches
    const matchesRes = await fetch(
      `https://api.football-data.org/v4/competitions/${COMPETITION}/matches`,
      {
        headers: { "X-Auth-Token": apiKey },
      },
    );
    if (!matchesRes.ok)
      throw new Error(`Matches API ${matchesRes.status}: ${await matchesRes.text()}`);
    const matchesData = (await matchesRes.json()) as { matches?: FootballDataMatch[] };

    const stageMap: Record<string, string> = {
      GROUP_STAGE: "group",
      LAST_16: "round_of_16",
      QUARTER_FINALS: "quarter",
      SEMI_FINALS: "semi",
      THIRD_PLACE: "third_place",
      FINAL: "final",
      LAST_32: "round_of_32",
    };
    const statusMap: Record<string, string> = {
      SCHEDULED: "scheduled",
      TIMED: "scheduled",
      IN_PLAY: "live",
      PAUSED: "live",
      FINISHED: "finished",
      POSTPONED: "postponed",
      CANCELLED: "cancelled",
      SUSPENDED: "postponed",
    };

    const matchRows = (matchesData.matches ?? []).map((m) => ({
      external_id: String(m.id),
      stage: stageMap[m.stage] ?? "group",
      group_name: m.group ? String(m.group).replace("GROUP_", "") : null,
      home_team_id: map.get(String(m.homeTeam?.id)) ?? null,
      away_team_id: map.get(String(m.awayTeam?.id)) ?? null,
      kickoff_at: m.utcDate,
      home_score: m.score?.fullTime?.home ?? null,
      away_score: m.score?.fullTime?.away ?? null,
      status: statusMap[m.status] ?? "scheduled",
      venue: m.venue ?? null,
    }));

    if (matchRows.length) {
      const { error } = await supabase
        .from("matches")
        .upsert(matchRows, { onConflict: "external_id" });
      if (error) throw new Error(`matches upsert: ${error.message}`);
    }

    // 3. Trigger scoring for finished matches
    const finishedIds = matchRows.filter((m) => m.status === "finished").map((m) => m.external_id);

    return new Response(
      JSON.stringify({
        ok: true,
        teams: teamRows.length,
        matches: matchRows.length,
        finished: finishedIds.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown error";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
