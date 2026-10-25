import { createConnection } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { demand, type Actor } from "../../contracts/src/index";
import { insert, type DB } from "../../db/src/index";
import { audit, authorize, resource } from "../../core/src/security";
export interface PrivateStorage {
  upload(path: string, data: Buffer, mime: string): Promise<void>;
  sign(path: string): Promise<string>;
}
export function supabaseStorage(
  url: string,
  key: string,
  bucket = "dim-private",
): PrivateStorage {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async upload(path, data, mime) {
      const result = await client.storage
        .from(bucket)
        .upload(path, data, { contentType: mime, upsert: false });
      demand(
        !result.error,
        "STORAGE_UNAVAILABLE",
        "Falha ao armazenar arquivo privado",
        503,
      );
    },
    async sign(path) {
      const result = await client.storage
        .from(bucket)
        .createSignedUrl(path, 60);
      demand(
        result.data?.signedUrl,
        "STORAGE_UNAVAILABLE",
        "Falha ao assinar download",
        503,
      );
      return result.data.signedUrl;
    },
  };
}
export function sniffMime(data: Buffer) {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (data.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    data.subarray(0, 4).toString() === "RIFF" &&
    data.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return undefined;
}
export async function clamScan(
  data: Buffer,
  host: string,
  port = 3310,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let result = "";
    socket.setTimeout(10000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("AV_TIMEOUT"));
    });
    socket.on("error", () => reject(new Error("AV_UNAVAILABLE")));
    socket.on("data", (chunk) => {
      result += chunk.toString();
    });
    socket.on("end", () => {
      try {
        demand(
          result.includes("stream: OK"),
          "MALWARE_DETECTED",
          "Arquivo reprovado na verificação",
        );
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < data.length; offset += 65536) {
        const chunk = data.subarray(offset, offset + 65536);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
export async function uploadPrivate(
  db: DB,
  actor: Actor,
  storage: PrivateStorage,
  scan: (data: Buffer) => Promise<void>,
  input: { base64: string; mime_type: string; influencer_id: string },
) {
  await resource(db, "influencers", input.influencer_id, actor);
  authorize(actor, "governance.write", { influencerId: input.influencer_id });
  const data = Buffer.from(input.base64, "base64");
  demand(
    data.length > 0 && data.length <= 5 * 1024 * 1024,
    "FILE_TOO_LARGE",
    "Arquivo deve ter no máximo 5 MB",
  );
  demand(
    sniffMime(data) === input.mime_type,
    "INVALID_MIME",
    "Formato real do arquivo não corresponde ao MIME",
  );
  await scan(data);
  const path = `${actor.organizationId}/${input.influencer_id}/${randomUUID()}`;
  await storage.upload(path, data, input.mime_type);
  const row = await insert(db, "storage_objects", {
    organization_id: actor.organizationId,
    influencer_id: input.influencer_id,
    bucket: "dim-private",
    object_path: path,
    mime_type: input.mime_type,
    byte_size: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    visibility: "private",
    created_by: actor.userId,
    scan_status: "clean",
  });
  await audit(db, actor, "upload", "storage_objects", row.id, {
    mime_type: input.mime_type,
    byte_size: data.length,
  });
  return row;
}
