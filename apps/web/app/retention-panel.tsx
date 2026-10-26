"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { ErrorBanner, StatusChip } from "../../../packages/ui/src/index";
export default function RetentionPanel({
  organization,
}: {
  organization: string;
}) {
  const [opened, setOpened] = useState(false),
    [policy, setPolicy] = useState<any>(),
    [requests, setRequests] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [preview, setPreview] = useState<any>();
  useEffect(() => {
    if (!opened) return;
    let active = true;
    Promise.all([
      api("/privacy/retention-policy", organization),
      api("/privacy/requests", organization),
      api("/privacy/external-jobs", organization),
    ])
      .then(([p, r, j]) => {
        if (active) {
          setPolicy(p);
          setRequests(r.requests);
          setJobs(j.jobs);
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [organization, opened, revision]);
  async function run(path: string, body: any, label: string) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const result = await api(path, organization, "POST", body);
      if (result.dry_run) setPreview(result);
      else setPreview(undefined);
      setInfo(label);
      setRevision((value) => value + 1);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="panel"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>Privacidade, retencao e exclusao revisada</summary>
      <p>
        Administradores com MFA revisam pedidos de outro responsavel. O plano
        externo exige uma segunda revisao independente do hash e simulacao antes
        da execucao. Consentimentos e auditoria imutaveis sao preservados.
      </p>
      {error && <ErrorBanner error={error} />}{" "}
      {info && <p role="status">{info}</p>}
      {policy && (
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const destinations = ["storage", "provider", "backup"]
              .filter((kind) => form.get(`${kind}_enabled`) === "on")
              .map((kind) => ({
                id: String(form.get(`${kind}_id`)),
                kind,
                minimum_age_days: Number(form.get(`${kind}_days`)),
              }));
            void run(
              "/privacy/retention-policy",
              { enabled: form.get("enabled") === "on", destinations },
              "Politica de exclusao salva.",
            );
          }}
        >
          <label>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={policy.settings.enabled}
            />
            Habilitar destinos de exclusao
          </label>
          {["storage", "provider", "backup"].map((kind) => {
            const destination = policy.settings.destinations.find(
              (d: any) => d.kind === kind,
            );
            return (
              <fieldset key={kind}>
                <legend>
                  {kind === "storage"
                    ? "Arquivos privados"
                    : kind === "provider"
                      ? "Dados nos provedores"
                      : "Dados nos backups"}
                </legend>
                <label>
                  <input
                    type="checkbox"
                    name={`${kind}_enabled`}
                    defaultChecked={Boolean(destination)}
                  />
                  Usar destino
                </label>
                <label>
                  Identificador configurado no cofre
                  <input
                    name={`${kind}_id`}
                    pattern="[a-z0-9-]{1,60}"
                    defaultValue={destination?.id || ""}
                  />
                </label>
                <label>
                  Idade minima do cadastro, em dias
                  <input
                    type="number"
                    name={`${kind}_days`}
                    min={0}
                    max={3650}
                    defaultValue={destination?.minimum_age_days || 0}
                  />
                </label>
              </fieldset>
            );
          })}
          <small>
            As credenciais e endpoints ficam exclusivamente no cofre, no caminho
            dim/organizacao/retention/identificador. O destino deve fornecer
            exclusao e readback autenticado.
          </small>
          <button disabled={busy}>Salvar politica com MFA</button>
        </form>
      )}
      <h3>Pedidos do titular</h3>
      {!requests.length && <p>Nenhum pedido registrado.</p>}
      {requests.map((request) => (
        <article className="panel" key={request.id}>
          <h4>
            {request.payload.request_type} ·{" "}
            <StatusChip status={request.status} />
          </h4>
          <p>{request.payload.reason}</p>
          <small>Contato {request.subject_id}</small>
          {request.status === "pending_human" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void run(
                  `/privacy/requests/${request.id}/review`,
                  {
                    decision: form.get("decision"),
                    reason: form.get("reason"),
                    lawful_basis: form.get("lawful_basis"),
                    retain_evidence: true,
                  },
                  "Revisao do pedido registrada.",
                );
              }}
            >
              <label>
                Decisao
                <select name="decision">
                  <option value="approve">Aprovar</option>
                  <option value="reject">Rejeitar</option>
                </select>
              </label>
              <label>
                Fundamento e retencao de provas
                <textarea name="lawful_basis" required />
              </label>
              <label>
                Justificativa
                <textarea name="reason" required />
              </label>
              <button disabled={busy}>
                Revisar como outro responsavel com MFA
              </button>
            </form>
          )}
          {["approved_human", "completed_partial"].includes(request.status) &&
            request.payload.request_type === "erasure" && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    `/privacy/requests/${request.id}/external-plan`,
                    {},
                    "Planos externos preparados para revisao independente.",
                  )
                }
              >
                Preparar planos externos preservando provas
              </button>
            )}
          {request.status === "approved_human" &&
            ["erasure", "restriction"].includes(
              request.payload.request_type,
            ) && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    `/privacy/requests/${request.id}/execute`,
                    {
                      reason: form.get("reason"),
                      dry_run: form.get("execute") !== "on",
                    },
                    form.get("execute") === "on"
                      ? "Execucao local concluida; confira os destinos externos."
                      : "Simulacao local concluida.",
                  );
                }}
              >
                <label>
                  Justificativa operacional
                  <textarea required name="reason" />
                </label>
                <label>
                  <input type="checkbox" name="execute" />
                  Executar alteracoes locais revisadas (desmarcado: simular)
                </label>
                <button disabled={busy}>Processar pedido local</button>
              </form>
            )}
        </article>
      ))}
      <h3>Planos externos e recibos</h3>
      {jobs.map((job) => (
        <article className="panel" key={job.id}>
          <h4>
            {job.payload.plan?.destination.id} ·{" "}
            <StatusChip status={job.status} />
          </h4>
          <p>
            {job.payload.plan?.targets.length} alvo(s). Hash do plano:{" "}
            <code>{job.payload.plan_hash}</code>
          </p>
          {job.status === "pending_human" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void run(
                  `/privacy/external-jobs/${job.id}/review`,
                  {
                    decision: form.get("decision"),
                    reason: form.get("reason"),
                    plan_hash: job.payload.plan_hash,
                  },
                  "Revisao do plano externo registrada.",
                );
              }}
            >
              <label>
                Decisao
                <select name="decision">
                  <option value="approve">Aprovar plano exato</option>
                  <option value="reject">Rejeitar</option>
                </select>
              </label>
              <label>
                Conferencia dos alvos e provas
                <textarea name="reason" required />
              </label>
              <button disabled={busy}>
                Revisar plano como outro responsavel com MFA
              </button>
            </form>
          )}
          {["approved_human", "uncertain"].includes(job.status) && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    `/privacy/external-jobs/${job.id}/execute`,
                    {
                      dry_run: true,
                      expected_receipt_hash: job.payload.expected_receipt_hash,
                    },
                    "Simulacao do plano externo concluida.",
                  )
                }
              >
                Simular plano e recibo esperado
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    `/privacy/external-jobs/${job.id}/execute`,
                    {
                      dry_run: false,
                      expected_receipt_hash: job.payload.expected_receipt_hash,
                    },
                    job.status === "uncertain"
                      ? "Readback consultado; estado atualizado."
                      : "Exclusao confirmada pelo recibo exato e readback.",
                  )
                }
              >
                {job.status === "uncertain"
                  ? "Reconciliar no destino sem reenviar"
                  : "Executar plano aprovado e verificar recibo"}
              </button>
            </>
          )}
          {job.result?.receipt && (
            <p>
              Confirmado: {job.result.receipt.operationId} · hash{" "}
              {job.result.receipt.planHash}. Provas preservadas:{" "}
              {job.result.receipt.retainedEvidence.join(", ")}.
            </p>
          )}
        </article>
      ))}
      {preview && (
        <p role="status">
          Simulacao:{" "}
          {preview.messages ?? preview.payload?.plan?.targets.length ?? 0}{" "}
          alvo(s); nenhuma exclusao efetuada.{" "}
          {preview.external_erasure_required
            ? "Destinos externos permanecem sujeitos aos planos revisados."
            : ""}
        </p>
      )}
    </details>
  );
}
