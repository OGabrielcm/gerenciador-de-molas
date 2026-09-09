import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
const name = `molas-organization-test-${process.pid}`;
const envFile = `test-results/${name}.env`;
function run(args, input) {
  const r = spawnSync("docker", args, { input, encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0)
    throw new Error(r.stderr || r.error?.message || `Docker command failed: ${args[0]}`);
  return r.stdout;
}
mkdirSync("test-results", { recursive: true });
writeFileSync(envFile, `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}\n`, { mode: 0o600 });
let started = false;
try {
  run([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "none",
    "--env-file",
    envFile,
    "postgres:17-alpine",
  ]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = spawnSync(
      "docker",
      ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
      {
        stdio: "ignore",
        timeout: 5000,
      },
    );
    if (r.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  const files = [
    "tests/integration/auth-test-only.sql",
    "tests/integration/local-baseline.sql",
    "supabase/migrations/supabase_tracks_migration.sql",
    "supabase/migrations/supabase_activities_comments_time_migration.sql",
    "supabase/migrations/202609090001_board_organization.sql",
    "tests/integration/organization.sql",
  ];
  const output = run(
    ["exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
    files.map((path) => readFileSync(path, "utf8")).join("\n"),
  );
  if (!output.includes("PostgreSQL transaction, RLS, timestamps and retention checks passed"))
    throw new Error("Expected SQL assertions did not complete");
  console.log(
    "PostgreSQL checks passed (real database; test-only auth.uid identity, no live Auth/Storage).",
  );
} finally {
  if (started) spawnSync("docker", ["rm", "-f", name], { stdio: "ignore", timeout: 30000 });
  unlinkSync(envFile);
}
