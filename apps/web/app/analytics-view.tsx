"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { ErrorBanner, Empty, StatusChip } from "../../../packages/ui/src/index";
import { dateKey, shiftDate } from "../../../packages/contracts/src/calendar";
export default function AnalyticsView({
  organization,
}: {
  organization: string;
}) {
  const today = dateKey(new Date()),
    [from, setFrom] = useState(shiftDate(today, -30)),
    [to, setTo] = useState(today),
    [data, setData] = useState<any>(),
    [error, setError] = useState("");
  useEffect(() => {
    let valid = true;
    setData(undefined);
    api(
      `/analytics/overview?from=${from}T00:00:00Z&to=${shiftDate(to, 1)}T00:00:00Z`,
      organization,
    )
      .then((r) => {
        if (valid) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (valid) setError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [organization, from, to]);
  return (
    <section className="panel">
      <div className="toolbar">
        <label>
          De (UTC)
          <input
            required
            type="date"
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </label>
        <label>
          Até (UTC, inclusive)
          <input
            required
            type="date"
            value={to}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </label>
      </div>
      {error && <ErrorBanner error={error} />}
      <p>Comparação com o período anterior de mesma duração.</p>
      <h2>Receitas e custos por moeda</h2>
      <table>
        <thead>
          <tr>
            <th>Tipo e moeda</th>
            <th>Período</th>
            <th>Anterior</th>
          </tr>
        </thead>
        <tbody>
          {data?.financial.map((f: any) => (
            <tr key={`${f.currency}-${f.kind}`}>
              <td>
                {f.kind === "cost" ? "Custo" : "Receita"} · {f.currency}
              </td>
              <td>{f.amount}</td>
              <td>
                {data.previous.financial.find(
                  (p: any) => p.currency === f.currency && p.kind === f.kind,
                )?.amount || "Sem registro"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Métricas por provedor</h2>
      <p className="muted">
        O total é a última amostra acumulada até o fim do período. A variação
        usa a amostra inicial; ausências permanecem explícitas.
      </p>
      {data?.metrics.map((m: any) => (
        <article key={`${m.provider}-${m.metric_code}`}>
          <h3>
            {m.provider} · {m.metric_code}
          </h3>
          <p>
            Total: {m.value} · Variação: {m.delta ?? "Sem base"} · Variação
            anterior:{" "}
            {data.previous.metrics.find(
              (p: any) =>
                p.provider === m.provider && p.metric_code === m.metric_code,
            )?.delta ?? "Sem base"}
          </p>
          <StatusChip status={m.stale ? "stale" : "success"} />
          <small>
            {m.source} · {new Date(m.observed_at).toLocaleString("pt-BR")} ·{" "}
            {m.missing_baselines} posts sem base de comparação
          </small>
        </article>
      ))}
      {data && !data.metrics.length && (
        <Empty description="Ainda não há métricas coletadas para este período." />
      )}
    </section>
  );
}
