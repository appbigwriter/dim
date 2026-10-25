import { pathToFileURL } from "node:url";
import { audienceFixture } from "../tests/audience-fixture";
// Explicit local source path; no runtime dependency between the two checkouts.
if (!process.argv[2])
  throw new Error(
    "Informe o caminho do contrato persona-intake.ts do FBR Audience",
  );
const source = await import(pathToFileURL(process.argv[2]).href);
const result = source.validatePersonaIntakePackage(
  audienceFixture().personaPackage,
);
if (!result.ok) throw new Error(JSON.stringify(result.errors));
console.log(
  "DIM fixture is compatible with the actual Audience Builder persona-intake.v1 validator. No external request.",
);
