"use client";
import { useState } from "react";
import { api } from "./client";
export default function VersionDiff({
  endpoint,
  organization,
}: {
  endpoint: string;
  organization: string;
}) {
  const [comparison, setComparison] = useState<any>(),
    [error, setError] = useState("");
  return (
    <section className="version-diff">
      <button
        className="secondary"
        onClick={async () => {
          try {
            setComparison(await api(endpoint, organization));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Comparar últimas versões
      </button>
      {error && <p role="alert">{error}</p>}
      {comparison && (
        <>
          <p>
            {comparison.changed
              ? "Foram encontradas alterações."
              : "Não há duas versões diferentes para comparar."}
          </p>
          <div className="form-grid">
            <article>
              <h3>Anterior</h3>
              <pre>{JSON.stringify(comparison.from, null, 2)}</pre>
            </article>
            <article>
              <h3>Atual</h3>
              <pre>{JSON.stringify(comparison.to, null, 2)}</pre>
            </article>
          </div>
        </>
      )}
    </section>
  );
}
