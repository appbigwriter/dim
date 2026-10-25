export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const result = await fetch(
      `${process.env.API_INTERNAL_URL || "http://127.0.0.1:3001"}/health/ready`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) },
    );
    return new Response(await result.text(), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
