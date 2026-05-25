import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const functionsDir = path.join(root, "supabase/functions");
const failures = [];

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

for (const file of walk(functionsDir)) {
  const source = readFileSync(file, "utf8");
  const importPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveImport(file, specifier);
    check(Boolean(resolved), `${path.relative(root, file)} imports missing ${specifier}`);
  }
}

const adminAuthPath = path.join(functionsDir, "_shared/admin-auth.ts");
check(existsSync(adminAuthPath), "supabase/functions/_shared/admin-auth.ts is missing");

if (failures.length) {
  console.error("Edge Function import verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Edge Function import verification passed.");
