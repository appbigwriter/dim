"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
let memoryToken: string | null = null;

export function setSimpleToken(token: string) {
  memoryToken = token;
  if (typeof window !== "undefined") {
    localStorage.setItem("dim.auth_token", token);
  }
}

export function getSimpleToken(): string | null {
  if (memoryToken) return memoryToken;
  if (typeof window !== "undefined") {
    return localStorage.getItem("dim.auth_token");
  }
  return null;
}

export function clearSimpleToken() {
  memoryToken = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("dim.auth_token");
    localStorage.removeItem("dim.organization");
  }
}

export function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Retorna um mock gracioso caso o Supabase não esteja disponível
    return {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: async () => ({ error: new Error("Supabase não configurado") }),
        signOut: async () => {},
        mfa: {
          listFactors: async () => ({ data: { totp: [] } }),
          challengeAndVerify: async () => ({ error: new Error("MFA não disponível") }),
          enroll: async () => ({ error: new Error("MFA não disponível") }),
        },
      },
    } as any;
  }
  return (client ||= createClient(url, key));
}

export async function api(
  path: string,
  organization: string,
  method = "GET",
  body?: any,
  key?: string,
) {
  let token = getSimpleToken();
  if (!token) {
    try {
      const { data } = await authClient().auth.getSession();
      token = data.session?.access_token || "";
    } catch {
      token = "";
    }
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || "/api/v1"}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token || ""}`,
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
