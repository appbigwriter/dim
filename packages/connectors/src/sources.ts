import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
import { demand } from "../../contracts/src/index";
export function publicAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    isIP(ip) === 6 &&
    /^[23]/i.test(ip) &&
    !/^(?:2002:|2001:(?:0{1,4}|db8|0?10|0?20):)/i.test(ip) &&
    !ip.toLowerCase().includes("ffff")
  );
}
export type SourceSnapshot = {
  url: string;
  text: string;
  sha256: string;
  observed_at: string;
};
export type SourceReader = (
  url: string,
  allowedDomains: string[],
) => Promise<SourceSnapshot>;
export async function validateSourceUrl(
  raw: string,
  domains: string[],
  resolve: typeof lookup = lookup,
) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  demand(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      !isIP(host) &&
      domains.some((d) => host === d || host.endsWith("." + d)),
    "SOURCE_ORIGIN_BLOCKED",
    "Fonte fora dos domínios públicos aprovados",
    422,
  );
  const addresses = await resolve(host, { all: true, verbatim: true });
  demand(
    addresses.length && addresses.every((a) => publicAddress(a.address)),
    "SOURCE_ADDRESS_BLOCKED",
    "Fonte resolve para rede não pública",
    422,
  );
  return { url, address: addresses[0] };
}
export const readSource: SourceReader = async (raw, domains) => {
  const { url, address } = await validateSourceUrl(raw, domains);
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        signal: AbortSignal.timeout(8000),
        headers: {
          Accept: "text/plain,text/html",
          "User-Agent": "DIM-source-verifier/1.0",
        },
        lookup: ((_host: any, options: any, cb: any) =>
          options?.all
            ? cb(null, [address])
            : cb(null, address.address, address.family)) as any,
      },
      (res) => {
        if (
          res.statusCode !== 200 ||
          !/^(?:text\/plain|text\/html)(?:;|$)/i.test(
            String(res.headers["content-type"] || ""),
          )
        ) {
          res.resume();
          reject(new Error("SOURCE_HTTP_REJECTED"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1048576) {
            res.destroy();
            reject(new Error("SOURCE_TOO_LARGE"));
          } else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.setTimeout(8000, () => req.destroy(new Error("SOURCE_TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
  const text = bytes
    .toString("utf8")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return {
    url: url.href,
    text,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    observed_at: new Date().toISOString(),
  };
};
