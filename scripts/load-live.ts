import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { z } from "zod";
// Read-only benchmark of explicitly prepared staging tenants; no provider sends.
if (process.env.APP_ENV !== "staging")
  throw new Error("Use an isolated staging environment");
const origin = new URL(process.env.LOAD_API_URL || "");
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash
)
  throw new Error("Configure HTTPS staging API origin");
const scenarios = z
  .array(
    z
      .object({
        influencers: z.union([z.literal(10), z.literal(50), z.literal(100)]),
        organization_id: z.uuid(),
        token_env: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
      })
      .strict(),
  )
  .length(3)
  .parse(
    JSON.parse(readFileSync(process.env.LOAD_SCENARIOS_FILE || "", "utf8")),
  );
if (new Set(scenarios.map((s) => s.influencers)).size !== 3)
  throw new Error("Provide the 10/50/100 staging scenarios");
const concurrency = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .parse(process.env.LOAD_CONCURRENCY || 10);
const requests = z.coerce
  .number()
  .int()
  .min(20)
  .max(10000)
  .parse(process.env.LOAD_REQUESTS || 100);
const results = [];
for (const scenario of scenarios) {
  const token = process.env[scenario.token_env];
  if (!token) throw new Error("Missing scoped staging token");
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Organization-Id": scenario.organization_id,
  };
  const baseline = await fetch(
    new URL("/api/v1/influencers?per_page=1", origin),
    { headers, redirect: "error", signal: AbortSignal.timeout(15000) },
  );
  if (!baseline.ok || (await baseline.json()).total !== scenario.influencers)
    throw new Error("Staging dataset count does not match the scenario");
  let next = 0,
    errors = 0;
  const times: number[] = [],
    codes: Record<string, number> = {},
    started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < requests) {
        const index = next++,
          at = performance.now();
        try {
          const response = await fetch(
            new URL(
              `/api/v1/influencers?per_page=25&page=${1 + (index % Math.ceil(scenario.influencers / 25))}`,
              origin,
            ),
            { headers, redirect: "error", signal: AbortSignal.timeout(30000) },
          );
          codes[response.status] = (codes[response.status] || 0) + 1;
          if (
            !response.ok ||
            (await response.json()).total !== scenario.influencers
          )
            errors++;
        } catch {
          errors++;
          codes.transport = (codes.transport || 0) + 1;
        } finally {
          times.push(performance.now() - at);
        }
      }
    }),
  );
  times.sort((a, b) => a - b);
  results.push({
    influencers: scenario.influencers,
    requests,
    concurrency,
    elapsed_ms: performance.now() - started,
    p50_ms: times[Math.floor(times.length * 0.5)],
    p95_ms: times[Math.floor(times.length * 0.95)],
    max_ms: times.at(-1),
    errors,
    status_codes: codes,
  });
}
const report = {
  executed_at: new Date().toISOString(),
  environment:
    "Explicit staging HTTPS API; concurrent read-only requests; no provider mutations",
  results,
};
writeFileSync(
  process.env.LOAD_REPORT_FILE || "docs/load-staging-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
if (results.some((r) => r.errors)) process.exitCode = 1;
