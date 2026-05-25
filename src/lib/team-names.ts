export function displayTeamName(name: string | null | undefined, code?: string | null): string {
  if (code === "BIH") return "Bósnia";
  if (!name) return "";

  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (normalized.includes("bosnia") && normalized.includes("herzegovina")) {
    return "Bósnia";
  }

  return name;
}

export function normalizeTeamForDisplay<T extends { name: string; code?: string | null }>(
  team: T,
): T {
  return { ...team, name: displayTeamName(team.name, team.code) };
}

export function normalizeTeamsForDisplay<T extends { name: string; code?: string | null }>(
  teams: T[],
): T[] {
  return teams.map(normalizeTeamForDisplay);
}
