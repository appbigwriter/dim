"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient | undefined;
export function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error(
      "Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para conectar o ambiente.",
    );
  return (client ||= createClient(url, key));
}
export async function api(
  path: string,
  organization: string,
  method = "GET",
  body?: any,
  key?: string,
) {
  const { data } = await authClient().auth.getSession();
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || "/api/v1"}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${data.session?.access_token || ""}`,
        "X-Organization-Id": organization,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `${result.message}${Array.isArray(result.details) ? ": " + result.details.map((d: any) => `${d.path?.join(".") || ""} ${d.message}`).join("; ") : ""} [${result.code}] · ${result.correlation_id}`,
    );
  return result;
}
