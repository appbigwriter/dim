import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { audienceContextSchema } from "../packages/contracts/src/audience";
mkdirSync("docs/contracts", { recursive: true });
writeFileSync(
  "docs/contracts/audience-context-v1.schema.json",
  JSON.stringify(z.toJSONSchema(audienceContextSchema), null, 2) + "\n",
);
console.log("Exported dim.audience-context.v1 consumer schema.");
