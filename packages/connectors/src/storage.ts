import { createConnection } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { demand, type Actor } from "../../contracts/src/index";
import { insert, type DB } from "../../db/src/index";
import { audit, authorize, resource } from "../../core/src/security";
export interface PrivateStorage {
  upload(path: string, data: Buffer, mime: string): Promise<void>;
  sign(path: string): Promise<string>;
  download?(path: string, maxBytes?: number): Promise<Buffer>;
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
    async download(path, maxBytes = 100 * 1024 * 1024) {
      const result = await client.storage.from(bucket).download(path);
      demand(
        result.data && !result.error,
        "STORAGE_UNAVAILABLE",
        "Falha ao carregar arquivo privado",
        503,
      );
      demand(
        result.data.size <= maxBytes,
        "FILE_TOO_LARGE",
        "Arquivo excede o limite autorizado",
      );
      return Buffer.from(await result.data.arrayBuffer());
    },
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
  if (
    data.length >= 16 &&
    data.readUInt32BE(0) >= 16 &&
    data.readUInt32BE(0) <= data.length &&
    data.subarray(4, 8).toString() === "ftyp" &&
    /^(isom|iso[2-9]|mp41|mp42|avc1|M4V )$/.test(
      data.subarray(8, 12).toString(),
    )
  )
    return "video/mp4";
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
  const maxBytes =
    input.mime_type === "video/mp4" ? 100 * 1024 * 1024 : 5 * 1024 * 1024;
  const padding = input.base64.indexOf("=");
  demand(
    input.base64.length <= Math.ceil(maxBytes / 3) * 4 &&
      input.base64.length % 4 === 0 &&
      !/[^A-Za-z0-9+/=]/.test(input.base64) &&
      (padding === -1 ||
        (padding >= input.base64.length - 2 &&
          /^={1,2}$/.test(input.base64.slice(padding)))),
    "INVALID_BASE64",
    "Arquivo Base64 inválido ou acima do limite",
  );
  const data = Buffer.from(input.base64, "base64");
  demand(
    data.length > 0 && data.length <= maxBytes,
    "FILE_TOO_LARGE",
    "Arquivo excede o limite autorizado para o formato",
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

/** Call inside a scoped transaction; the publication guard separately checks the current media license. */
export async function loadVerifiedMedia(
  db: DB,
  actor: Actor,
  assetId: string,
  storage: PrivateStorage,
) {
  const object = await resource(db, "storage_objects", assetId, actor);
  authorize(actor, "editorial.read", { influencerId: object.influencer_id });
  demand(
    object.influencer_id &&
      object.object_path?.startsWith(
        `${actor.organizationId}/${object.influencer_id}/`,
      ) &&
      !object.object_path.includes("..") &&
      object.bucket === "dim-private" &&
      object.visibility === "private" &&
      object.scan_status === "clean" &&
      /^[a-f0-9]{64}$/.test(object.sha256 || ""),
    "MEDIA_NOT_VERIFIED",
    "Mídia privada não verificada",
  );
  demand(
    storage.download,
    "MEDIA_TRANSPORT_REQUIRED",
    "Transporte privado de mídia não configurado",
    503,
  );
  const maxBytes =
    object.mime_type === "video/mp4" ? 100 * 1024 * 1024 : 5 * 1024 * 1024;
  demand(
    Number(object.byte_size) > 0 && Number(object.byte_size) <= maxBytes,
    "FILE_TOO_LARGE",
    "Tamanho da mídia inválido",
  );
  const bytes = await storage.download(object.object_path, maxBytes);
  demand(
    bytes.length === Number(object.byte_size) &&
      createHash("sha256").update(bytes).digest("hex") === object.sha256 &&
      sniffMime(bytes) === object.mime_type,
    "MEDIA_INTEGRITY_FAILED",
    "Bytes da mídia diferem do arquivo aprovado",
    409,
  );
  return {
    bytes,
    mime: object.mime_type as string,
    publicUrl: await storage.sign(object.object_path),
  };
}
