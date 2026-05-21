import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Lock, BookOpen, Trophy } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  buildStandings,
  computeQualifiers,
  sortGroup,
  type MatchLite,
  type PredLite,
  type TeamLite,
} from "@/lib/group-standings";
import { THIRD_PLACE_COMBINATION_NUMBERS } from "@/lib/wc2026-thirds-combination-numbers";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const LOCK_HOURS_BEFORE_START = 48; // 2 days

type TeamWithFlag = TeamLite & { flag_url: string | null };

type PredictionsTabProps = {
  onAdvanceToBracket?: () => void;
};

export function PredictionsTab({ onAdvanceToBracket }: PredictionsTabProps) {
  const { user } = useAuth();
  const qc = useQueryClient();

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

  const { data: matches } = useQuery({
    queryKey: ["matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("id,stage,group_name,home_team_id,away_team_id,kickoff_at")
        .order("kickoff_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: viewedPreds } = useQuery({
    queryKey: ["predictions-of", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("predictions")
        .select("match_id,home_score,away_score")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data as PredLite[];
    },
  });

  // Lock: fixed deadline 10/06/2026 14:00 Brasília (UTC-3) = 17:00 UTC
  const LOCK_DEADLINE_UTC = Date.UTC(2026, 5, 10, 17, 0, 0);
  const firstKickoff = useMemo(() => {
    if (!matches?.length) return null;
    return new Date(matches[0].kickoff_at);
  }, [matches]);
  const locked = useMemo(() => Date.now() >= LOCK_DEADLINE_UTC, [LOCK_DEADLINE_UTC]);
  const lockDeadline = new Date(LOCK_DEADLINE_UTC);

  // Local edit state for own predictions
  const [edits, setEdits] = useState<Record<string, { h: string; a: string }>>({});
  const savedRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!viewedPreds) return;
    const m: Record<string, { h: string; a: string }> = {};
    const saved: Record<string, string> = {};
    viewedPreds.forEach((p) => {
      m[p.match_id] = { h: String(p.home_score), a: String(p.away_score) };
      saved[p.match_id] = `${p.home_score}-${p.away_score}`;
    });
    setEdits(m);
    savedRef.current = saved;
  }, [viewedPreds, user?.id]);

  // Silent autosave when both inputs become valid and differ from last saved.
  useEffect(() => {
    if (!user || locked) return;
    const t = setTimeout(async () => {
      const rows: { user_id: string; match_id: string; home_score: number; away_score: number }[] =
        [];
      const keys: string[] = [];
      for (const [match_id, e] of Object.entries(edits)) {
        const hs = (e.h ?? "").trim(),
          as = (e.a ?? "").trim();
        if (hs === "" || as === "") continue;
        const h = parseInt(hs),
          a = parseInt(as);
        if (isNaN(h) || isNaN(a) || h < 0 || a < 0) continue;
        const key = `${h}-${a}`;
        if (savedRef.current[match_id] === key) continue;
        rows.push({ user_id: user.id, match_id, home_score: h, away_score: a });
        keys.push(match_id);
      }
      if (!rows.length) return;
      const { error } = await supabase
        .from("predictions")
        .upsert(rows, { onConflict: "user_id,match_id" });
      if (error) {
        toast.error(error.message);
        return;
      }
      rows.forEach((r, i) => {
        savedRef.current[keys[i]] = `${r.home_score}-${r.away_score}`;
      });
      qc.invalidateQueries({ queryKey: ["predictions-of", user.id] });
    }, 600);
    return () => clearTimeout(t);
  }, [edits, user, locked, qc]);

  const saveBulk = useMutation({
    mutationFn: async ({ matchIds, scope }: { matchIds: string[]; scope: string }) => {
      if (!user) throw new Error("Faça login para salvar seus palpites");
      if (locked) throw new Error("Palpites bloqueados");
      const rows: { user_id: string; match_id: string; home_score: number; away_score: number }[] =
        [];
      for (const id of matchIds) {
        const e = edits[id];
        if (!e) continue;
        const hs = (e.h ?? "").trim(),
          as = (e.a ?? "").trim();
        if (hs === "" || as === "") continue;
        const h = parseInt(hs),
          a = parseInt(as);
        if (isNaN(h) || isNaN(a) || h < 0 || a < 0) continue;
        rows.push({ user_id: user.id, match_id: id, home_score: h, away_score: a });
      }
      if (!rows.length) throw new Error("Nenhum placar preenchido para salvar");
      const { error } = await supabase
        .from("predictions")
        .upsert(rows, { onConflict: "user_id,match_id" });
      if (error) throw error;
      return { count: rows.length, scope };
    },
    onSuccess: ({ count, scope }) => {
      toast.success(
        `${count} palpite${count === 1 ? "" : "s"} salvo${count === 1 ? "" : "s"} (${scope})`,
      );
      qc.invalidateQueries({ queryKey: ["predictions-of", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!teams || !matches) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  const groupMatchesAll = matches.filter((m) => m.stage === "group");
  const groups = Array.from(
    new Set(teams.map((t) => t.group_name).filter((g): g is string => !!g)),
  ).sort();
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const flagFor = (teamId: string) => teamsById.get(teamId)?.flag_url ?? undefined;
  // For own view, derive live preds from local edits so standings/qualifiers
  // recompute instantly as the user types both scores.
  const preds: PredLite[] = Object.entries(edits).reduce<PredLite[]>((acc, [match_id, e]) => {
    const hs = (e.h ?? "").trim(),
      as = (e.a ?? "").trim();
    if (hs === "" || as === "") return acc;
    const h = parseInt(hs),
      a = parseInt(as);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return acc;
    acc.push({ match_id, home_score: h, away_score: a });
    return acc;
  }, []);

  const { qualified, byGroup } = computeQualifiers(teams, matches as MatchLite[], preds);
  const statsByTeam = new Map<string, { points: number; gd: number; gf: number }>();
  Object.values(byGroup).forEach((rows) =>
    rows.forEach((r) => statsByTeam.set(r.team.id, { points: r.points, gd: r.gd, gf: r.gf })),
  );

  return (
    <div className="space-y-8">
      {/* Header bar */}
      <div className="flex justify-end rounded-xl border border-border bg-card p-4">
        <Link
          to="/regras-fifa"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          <BookOpen className="h-3.5 w-3.5" /> Regras de desempate FIFA
        </Link>
      </div>

      {/* Lock banner */}
      {locked ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <Lock className="h-4 w-4 text-amber-500" />
          Palpites encerrados — a janela de envio fechou em 10/06 às 14:00 (horário de Brasília).
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          Palpites podem ser enviados até{" "}
          <strong className="text-foreground">10/06/2026 às 14:00 (horário de Brasília)</strong> (1
          dia antes do primeiro jogo).
        </div>
      )}

      {/* Groups */}
      {groups.map((g) => {
        const groupTeams = teams.filter((t) => t.group_name === g);
        const groupMatches = groupMatchesAll.filter((m) => m.group_name === g) as MatchLite[];
        const standings = sortGroup(
          buildStandings(groupTeams, groupMatches, preds),
          groupMatches,
          preds,
        );

        return (
          <section key={g} className="rounded-xl border border-border bg-card overflow-hidden">
            <header className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
              <h3 className="text-lg font-black uppercase tracking-tight">Grupo {g}</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{groupMatches.length} jogos</span>
                {!locked && (
                  <Button
                    size="sm"
                    onClick={() =>
                      saveBulk.mutate({
                        matchIds: groupMatches.map((m) => m.id),
                        scope: `Grupo ${g}`,
                      })
                    }
                    disabled={saveBulk.isPending}
                  >
                    Salvar grupo
                  </Button>
                )}
              </div>
            </header>

            <div className="grid gap-6 p-5 md:grid-cols-[1fr_minmax(260px,360px)]">
              {/* Matches */}
              <div className="space-y-2">
                {groupMatches.map((m) => {
                  const home = teamsById.get(m.home_team_id ?? "");
                  const away = teamsById.get(m.away_team_id ?? "");
                  const e = edits[m.id] ?? { h: "", a: "" };
                  return (
                    <div
                      key={m.id}
                      className="rounded-lg border border-border bg-background/40 p-3"
                    >
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <div className="flex items-center gap-2 justify-end min-w-0">
                          <span className="font-semibold truncate">{home?.name ?? "—"}</span>
                          {home?.flag_url && (
                            <img
                              src={home.flag_url}
                              alt=""
                              className="h-4 w-6 object-cover rounded-sm shrink-0"
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Input
                            className="w-12 h-9 text-center font-bold tabular-nums"
                            value={e.h}
                            onChange={(ev) =>
                              setEdits((p) => ({ ...p, [m.id]: { ...e, h: ev.target.value } }))
                            }
                            disabled={!user || locked}
                            inputMode="numeric"
                            maxLength={2}
                          />
                          <span className="text-muted-foreground">×</span>
                          <Input
                            className="w-12 h-9 text-center font-bold tabular-nums"
                            value={e.a}
                            onChange={(ev) =>
                              setEdits((p) => ({ ...p, [m.id]: { ...e, a: ev.target.value } }))
                            }
                            disabled={!user || locked}
                            inputMode="numeric"
                            maxLength={2}
                          />
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          {away?.flag_url && (
                            <img
                              src={away.flag_url}
                              alt=""
                              className="h-4 w-6 object-cover rounded-sm shrink-0"
                            />
                          )}
                          <span className="font-semibold truncate">{away?.name ?? "—"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {groupMatches.length === 0 && (
                  <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    Jogos do grupo ainda não cadastrados.
                  </div>
                )}
              </div>

              {/* Standings */}
              <div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-6">#</TableHead>
                      <TableHead>Seleção</TableHead>
                      <TableHead className="text-center">P</TableHead>
                      <TableHead className="text-center">J</TableHead>
                      <TableHead className="text-center">SG</TableHead>
                      <TableHead className="text-center">GP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {standings.map((row, i) => (
                      <TableRow
                        key={row.team.id}
                        className={i < 2 ? "bg-primary/5" : i === 2 ? "bg-amber-500/5" : undefined}
                      >
                        <TableCell className="font-bold tabular-nums">{i + 1}</TableCell>
                        <TableCell className="font-medium truncate">
                          <span className="inline-flex items-center gap-2">
                            {flagFor(row.team.id) && (
                              <img
                                src={flagFor(row.team.id)}
                                alt=""
                                className="h-3.5 w-5 object-cover rounded-sm"
                              />
                            )}
                            {row.team.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-center font-bold tabular-nums">
                          {row.points}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{row.played}</TableCell>
                        <TableCell className="text-center tabular-nums">
                          {row.gd > 0 ? `+${row.gd}` : row.gd}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{row.gf}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-sm bg-primary/40 mr-1" />{" "}
                  Classificados direto
                  <span className="inline-block h-2 w-2 rounded-sm bg-amber-500/40 ml-3 mr-1" />{" "}
                  Concorre a melhor 3º
                </p>
              </div>
            </div>
          </section>
        );
      })}

      {/* Knockout preview */}
      <section className="rounded-xl border border-primary/30 bg-primary/5 p-5">
        <div className="mb-3 flex items-center gap-2 text-primary">
          <Trophy className="h-5 w-5" />
          <h3 className="text-lg font-black uppercase tracking-tight">
            Classificados ao mata-mata (simulado)
          </h3>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Gerado automaticamente a partir dos palpites acima. Para escolher os vencedores das
          oitavas até a final, use a aba <strong>Palpites Chaveamento</strong>. Os confrontos dos 3º
          colocados seguem as 495 combinações oficiais da FIFA —{" "}
          <a
            href="https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            ver tabela na Wikipedia
          </a>
          .
          {(() => {
            const thirds = qualified.filter((q) => q.position === 3);
            if (thirds.length !== 8) return null;
            const key = thirds
              .map((t) => t.group)
              .sort()
              .join("");
            const n = THIRD_PLACE_COMBINATION_NUMBERS[key];
            if (!n) return null;
            return (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-bold text-primary">
                Combinação Nº {n} de 495
              </span>
            );
          })()}
        </p>
        {qualified.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground">
            Adicione palpites na fase de grupos para ver os classificados.
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
                    {items.map((q, idx) => (
                      <div
                        key={`${q.team.id}-${q.position}`}
                        className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
                      >
                        <span className="inline-flex items-center gap-2 min-w-0">
                          {flagFor(q.team.id) && (
                            <img
                              src={flagFor(q.team.id)}
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
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:justify-end">
        {!locked && (
          <Button
            onClick={() =>
              saveBulk.mutate({
                matchIds: groupMatchesAll.map((m) => m.id),
                scope: "todos os grupos",
              })
            }
            disabled={saveBulk.isPending}
          >
            Salvar todos os palpites
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onAdvanceToBracket}>
          Avançar para Palpites Chaveamento
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
