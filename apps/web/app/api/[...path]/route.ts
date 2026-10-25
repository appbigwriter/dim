import type { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const url = new URL(
    `/api/${path.map(encodeURIComponent).join("/")}`,
    process.env.API_INTERNAL_URL || "http://127.0.0.1:3001",
  );
  url.search = request.nextUrl.search;
  const headers = new Headers();
  for (const key of [
    "authorization",
    "content-type",
    "x-organization-id",
    "idempotency-key",
    "x-telegram-bot-api-secret-token",
    "x-hub-signature-256",
  ])
    if (request.headers.has(key)) headers.set(key, request.headers.get(key)!);
  try {
    let body: ArrayBuffer | undefined;
    if (!["GET", "HEAD"].includes(request.method) && request.body) {
      const reader = request.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          return Response.json(
            {
              code: "PAYLOAD_TOO_LARGE",
              message: "Limite de upload excedido",
              correlation_id: crypto.randomUUID(),
            },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      body = bytes.buffer;
    }
    const response = await fetch(url, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
        "X-Correlation-Id": response.headers.get("x-correlation-id") || "",
      },
    });
  } catch {
    return Response.json(
      {
        code: "API_UNAVAILABLE",
        message: "Conexão com a API indisponível",
        correlation_id: crypto.randomUUID(),
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
