import "dotenv/config";
import { z } from "zod";
import { postgres } from "../packages/db/src/index";
import { seedCatalog, seedOrganization } from "../packages/db/src/seed";
const userId = z.string().uuid().parse(process.env.BOOTSTRAP_USER_ID);
const name = z.string().min(1).parse(process.env.BOOTSTRAP_ORG_NAME);
const slug = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .parse(process.env.BOOTSTRAP_ORG_SLUG);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const db = postgres(process.env.DATABASE_URL);
try {
  const org = await db.transaction(async (tx) => {
    await seedCatalog(tx);
    return seedOrganization(tx, userId, name, slug);
  });
  console.log(
    JSON.stringify({
      organization_id: org.id,
      message: "Bootstrap complete. Sign in using MFA.",
    }),
  );
} finally {
  await db.close();
}
