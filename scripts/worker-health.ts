import "dotenv/config";
import { Redis } from "ioredis";
if (!process.env.REDIS_URL) process.exit(1);
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  connectTimeout: 3000,
});
try {
  const value = await redis.get("dim:worker:heartbeat");
  process.exitCode =
    value && Date.now() - new Date(value).getTime() < 30000 ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  await redis.quit();
}
