import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fixture } from "../tests/helpers";
import { createResource } from "../packages/core/src/resources";
import { scoped } from "../packages/core/src/security";
import { buildApp } from "../apps/api/src/app";
const results = [];
for (const count of [10, 50, 100]) {
  const f = await fixture();
  const app = await buildApp({ db: f.db, authenticate: async () => f.actor });
  try {
    const seed = performance.now();
    for (let i = 0; i < count; i++)
      await scoped(f.db, f.actor, (tx) =>
        createResource(tx, f.actor, "influencers", {
          public_name: `Fixture ${i}`,
          internal_name: `Fixture ${i}`,
          slug: `load-${i}`,
          type: ["human", "virtual", "hybrid"][i % 3],
          owner_user_id: f.admin,
        }),
      );
    const seedMs = performance.now() - seed,
      times: number[] = [];
    let correlationId = "";
    for (let i = 0; i < 120; i++) {
      const start = performance.now();
      const response = await app.inject({
        url: `/api/v1/influencers?per_page=25&page=${1 + (i % Math.ceil(count / 25))}`,
        headers: {
          authorization: "Bearer local-test",
          "x-organization-id": f.org.id,
        },
      });
      if (response.statusCode !== 200 || response.json().total !== count)
        throw new Error(`Load request failed: ${response.body}`);
      times.push(performance.now() - start);
      correlationId = String(response.headers["x-correlation-id"]);
    }
    times.sort((a, b) => a - b);
    results.push({
      influencers: count,
      requests: times.length,
      concurrency: 1,
      seed_ms: +seedMs.toFixed(1),
      p50_ms: +times[Math.floor(times.length * 0.5)].toFixed(2),
      p95_ms: +times[Math.floor(times.length * 0.95)].toFixed(2),
      max_ms: +times.at(-1)!.toFixed(2),
      errors: 0,
      correlation_example: correlationId,
    });
  } finally {
    await app.close();
    await f.db.close();
  }
}
writeFileSync(
  "docs/load-report.json",
  JSON.stringify(
    {
      executed_at: new Date().toISOString(),
      environment:
        "Local PGlite + Fastify injection, sequential HTTP simulation; not a VPS/Supabase/Redis capacity benchmark",
      results,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(results));
