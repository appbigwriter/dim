"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { ErrorBanner, StatusChip } from "../../../packages/ui/src/index";

export default function AudienceActionsPanel({
  organization,
  id,
}: {
  organization: string;
  id: string;
}) {
  const [actions, setActions] = useState<any[]>([]),
    [executions, setExecutions] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api(`/influencers/${id}/audience/executions`, organization)
      .then((result) => {
        if (active) setExecutions(result.executions);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [organization, id, revision]);
  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, organization, body ? "POST" : "GET", body);
      if (result.actions) setActions(result.actions);
      setRevision((value) => value + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Ações aprovadas Audience">
      <h4>Ações aprovadas e resultados</h4>
      <p>
        Busque as ações da origem para preparar o conteúdo no DIM. Após a
        revisão editorial independente, a ação pode entrar na agenda aprovada.
      </p>
      {error && <ErrorBanner error={error} />}
      <button
        disabled={busy}
        onClick={() => void run(`/influencers/${id}/audience/actions`)}
      >
        Buscar ações aprovadas no Audience
      </button>
      {actions.map((action) => (
        <article className="panel" key={action.actionId}>
          <strong>{action.content.title || action.actionId}</strong>
          <p>
            {action.channel} ·{" "}
            {new Date(action.scheduledAt).toLocaleString("pt-BR")}
          </p>
          <p>{action.content.text}</p>
          <button
            disabled={
              busy || executions.some((e) => e.action_id === action.actionId)
            }
            onClick={() =>
              void run(`/influencers/${id}/audience/import-action`, {
                action_id: action.actionId,
              })
            }
          >
            Preparar para revisão no DIM
          </button>
        </article>
      ))}
      {executions.map((execution) => (
        <article className="panel" key={execution.id}>
          <strong>{execution.action_id}</strong> ·{" "}
          <StatusChip status={execution.last_status} />
          <p>
            <a href={`/studio/${execution.content_id}`}>
              Abrir conteúdo para revisão
            </a>
          </p>
          {execution.last_status === "awaiting_review" &&
            (execution.automatic ? (
              <p>O executor configurado agendará esta ação após a revisão.</p>
            ) : (
              <button
                disabled={busy}
                onClick={() =>
                  void run(`/audience/executions/${execution.id}/schedule`, {})
                }
              >
                Agendar versão revisada
              </button>
            ))}
        </article>
      ))}
    </section>
  );
}
