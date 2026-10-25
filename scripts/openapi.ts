import { writeFileSync } from "node:fs";
import { buildApp } from "../apps/api/src/app";
import type { Database } from "../packages/db/src/index";
const db: Database = {
  query: async () => ({ rows: [] }),
  transaction: async (fn) => fn(db),
  close: async () => {},
};
const app = await buildApp({
  db,
  authenticate: async () => {
    throw new Error("Documentation only");
  },
});
writeFileSync("docs/openapi.json", JSON.stringify(app.swagger(), null, 2));
console.log(
  `${Object.keys(app.swagger().paths || {}).length} documented paths`,
);
await app.close();
