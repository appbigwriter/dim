"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import { ResourceForm, UploadPanel } from "./forms";
import { ErrorBanner, StatusChip } from "../../../packages/ui/src/index";
const codes = [
  "identity",
  "rights",
  "approval",
  "infrastructure",
  "accounts",
  "editorial",
  "tests",
  "activation",
];
const labels = [
  "Identidade",
  "Persona e direitos",
  "Aprovação humana",
  "Infraestrutura",
  "Contas sociais",
  "Editorial",
  "Testes",
  "Ativação",
];
export default function Wizard({
  identity,
  organization,
  schema,
  onDone,
}: {
  identity?: any;
  organization: string;
  schema: any;
  onDone: (value: any) => void;
}) {
  const [person, setPerson] = useState(identity),
    [check, setCheck] = useState<any>(),
    [current, setCurrent] = useState(0),
    [draft, setDraft] = useState<any>({}),
    [forms, setForms] = useState<any>({}),
    [resource, setResource] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const restore = useCallback(
    async (p: any, resume = false) => {
      const sessions = await api(
        `/onboarding-sessions?influencer_id=${p.id}`,
        organization,
      );
      const result = await api(
        `/onboarding-sessions/${sessions.data[0].id}/checklist`,
        organization,
      );
      setCheck(result);
      setPerson(result.identity);
      if (resume) {
        setCurrent(Math.max(0, codes.indexOf(result.session.current_step)));
        setDraft(
          result.steps.find(
            (s: any) => s.step_code === result.session.current_step,
          )?.data || {},
        );
      }
      return result;
    },
    [organization],
  );
  useEffect(() => {
    api("/forms", organization)
      .then((r) => setForms(r.resources))
      .catch((e) => setError(e.message));
    if (identity) restore(identity, true).catch((e) => setError(e.message));
  }, [organization, identity, restore]);
  const code = codes[current],
    sessionId = check?.session.id;
  const save = useCallback(async () => {
    if (!sessionId) return;
    await api(`/onboarding-sessions/${sessionId}/steps`, organization, "POST", {
      step_code: code,
      data: draft,
      status: "in_progress",
    });
    setStatus("Progresso salvo");
  }, [sessionId, organization, code, draft]);
  useEffect(() => {
    if (!sessionId || check?.session.status === "completed") return;
    const timer = setTimeout(
      () => save().catch((e) => setError(e.message)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [save, sessionId, check?.session.status]);
  async function move(index: number) {
    try {
      await save();
      const latest = person ? await restore(person) : check;
      setDraft(
        latest?.steps.find((s: any) => s.step_code === codes[index])?.data ||
          {},
      );
      setCurrent(index);
      setResource("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function command(path: string, body: any) {
    setBusy(true);
    try {
      await save();
      await api(path, organization, "POST", body);
      await restore(person);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function field(name: string, label: string, multiline = false) {
    return (
      <label>
        {label}
        {multiline ? (
          <textarea
            value={draft[name] || ""}
            onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
          />
        ) : (
          <input
            value={draft[name] || ""}
            onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
          />
        )}
      </label>
    );
  }
  const options =
    code === "rights"
      ? [
          ...(person?.type !== "virtual"
            ? ["legal-parties", "contracts", "identity-consents"]
            : []),
          ...(person?.type !== "human" ? ["disclosures"] : []),
        ]
      : code === "accounts"
        ? ["accounts", "account-tasks"]
        : code === "editorial"
          ? ["policies"]
          : ["onboarding-tasks"];
  if (person && !person.public_name)
    return (
      <section className="panel" aria-busy="true">
        Carregando cadastro…{error && <ErrorBanner error={error} />}
      </section>
    );
  return (
    <section className="panel wizard">
      <div className="wizard-steps">
        {labels.map((label, i) => (
          <button
            key={label}
            disabled={!person || busy}
            className={i === current ? "selected" : ""}
            onClick={() => void move(i)}
          >
            <span>{i + 1}</span>
            {label}
          </button>
        ))}
      </div>
      <h2>{labels[current]}</h2>
      {error && <ErrorBanner error={error} />}
      <p role="status">{status}</p>
      {!person ? (
        <ResourceForm
          schema={schema}
          organization={organization}
          endpoint="/influencers"
          onCancel={() => location.assign("/influencers")}
          onSaved={async (p) => {
            setPerson(p);
            await restore(p, true);
            location.replace(`/influencers/${p.id}/onboarding`);
          }}
        />
      ) : (
        <>
          <p>
            <strong>{person.public_name}</strong> ·{" "}
            <StatusChip status={person.status} />
          </p>
          {code === "identity" && (
            <p>
              Cadastro criado. O responsável, fuso e tipo podem ser revisados na
              ficha da identidade.
            </p>
          )}
          {code === "rights" && (
            <>
              <p>
                {person.type === "human"
                  ? "Registre contrato assinado e autorizações de imagem e voz."
                  : person.type === "hybrid"
                    ? "Registre contrato, usos humanos e sintéticos, persona e transparência."
                    : "Registre persona aprovada e transparência por canal."}
              </p>
              {person.type !== "human" && (
                <div className="panel">
                  {field("public_bio", "Biografia pública", true)}
                  {field("tone", "Tom de voz")}
                  {field("traits", "Traços de personalidade")}
                  {field("knowledge", "Conhecimentos permitidos", true)}
                  {field("boundaries", "Limites e temas proibidos", true)}
                  <label>
                    <input
                      type="checkbox"
                      checked={!!draft.approve_persona}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          approve_persona: e.target.checked,
                        })
                      }
                    />
                    Aprovar esta versão com minha permissão de revisão
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void command(`/influencers/${person.id}/personas`, {
                        public_bio: draft.public_bio,
                        tone: { description: draft.tone || "" },
                        traits: { description: draft.traits || "" },
                        knowledge: { description: draft.knowledge || "" },
                        boundaries: { description: draft.boundaries || "" },
                        approval_status: draft.approve_persona
                          ? "approved"
                          : "draft",
                      })
                    }
                  >
                    Registrar nova versão da persona
                  </button>
                </div>
              )}
            </>
          )}
          {code === "approval" && (
            <>
              {field("comments", "Parecer da revisão", true)}
              <div className="form-actions">
                <button
                  disabled={busy || !draft.comments}
                  onClick={() =>
                    void command(`/onboarding-sessions/${sessionId}/approve`, {
                      decision: "approved",
                      comments: draft.comments,
                    })
                  }
                >
                  Aprovar onboarding
                </button>
                <button
                  className="secondary"
                  disabled={busy || !draft.comments}
                  onClick={() =>
                    void command(`/onboarding-sessions/${sessionId}/approve`, {
                      decision: "rejected",
                      comments: draft.comments,
                    })
                  }
                >
                  Solicitar correções
                </button>
              </div>
            </>
          )}
          {["infrastructure", "tests"].includes(code) && (
            <>
              <p>
                {code === "infrastructure"
                  ? "Documente a configuração e a titularidade da infraestrutura."
                  : "Anexe o relatório de testes e evidências do canal conectado."}
              </p>
              <UploadPanel organization={organization} />
              {field(
                "evidence_object_id",
                "Arquivo de evidência liberado (ID)",
              )}
              {field("notes", "Resultado e observações", true)}
            </>
          )}
          {code === "accounts" && (
            <>
              <p>
                Cadastre a conta e conecte pela integração oficial na ficha de
                contas. Cada tarefa de provisionamento precisa de evidência.
              </p>
              <a href="/accounts">Abrir contas e conexão oficial</a>
              {check?.accounts.map((a: any) => (
                <p key={a.id}>
                  {a.handle || a.id} ·{" "}
                  <StatusChip status={a.integration_status} />
                </p>
              ))}
            </>
          )}
          {code === "editorial" && (
            <>
              <p>
                Defina a política editorial e o quórum de revisão antes da
                ativação.
              </p>
              <label>
                Aprovações necessárias
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={draft.quorum || 1}
                  onChange={(e) =>
                    setDraft({ ...draft, quorum: Number(e.target.value) })
                  }
                />
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  void command("/security/policy", {
                    code: "editorial",
                    resource_type: "content",
                    conditions: {
                      required_approvals: draft.quorum || 1,
                      forbid_self_approval: true,
                    },
                    steps: ["human_review"],
                  })
                }
              >
                Registrar política editorial
              </button>
            </>
          )}
          {code !== "activation" && (
            <>
              <details>
                <summary>
                  Registrar documentos, tarefas e configurações desta etapa
                </summary>
                <div className="toolbar">
                  {options.map((key) => (
                    <button
                      key={key}
                      className="secondary"
                      onClick={() => setResource(key)}
                    >
                      {
                        (
                          {
                            "legal-parties": "Titular",
                            contracts: "Contrato",
                            "identity-consents": "Consentimento",
                            disclosures: "Transparência",
                            accounts: "Conta",
                            "account-tasks": "Tarefa de conta",
                            policies: "Política",
                            "onboarding-tasks": "Delegar tarefa",
                          } as any
                        )[key]
                      }
                    </button>
                  ))}
                </div>
                {resource && forms[resource] && (
                  <ResourceForm
                    key={resource}
                    schema={forms[resource].schema}
                    organization={organization}
                    endpoint={`/${resource}`}
                    initial={Object.fromEntries(
                      Object.entries({
                        influencer_id: person.id,
                        session_id: sessionId,
                      }).filter(
                        ([key]) => forms[resource].schema.properties[key],
                      ),
                    )}
                    onCancel={() => setResource("")}
                    onSaved={async () => {
                      setResource("");
                      await restore(person);
                    }}
                  />
                )}
              </details>
              <button
                disabled={busy || !sessionId}
                onClick={() =>
                  void command(
                    `/onboarding-sessions/${sessionId}/complete-step`,
                    { step: code },
                  )
                }
              >
                Validar e concluir etapa
              </button>
            </>
          )}
          {code === "activation" && (
            <>
              <h3>Checklist final</h3>
              {check?.steps.map((s: any) => (
                <p key={s.id}>
                  {labels[codes.indexOf(s.step_code)]} ·{" "}
                  <StatusChip status={s.status} />
                </p>
              ))}
              {check?.blockers.map((b: string) => (
                <p className="error" key={b}>
                  {b}
                </p>
              ))}
              {field("reason", "Justificativa de ativação", true)}
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Conferi os direitos, canais, testes e responsabilidades
              </label>
              <button
                disabled={
                  busy ||
                  !confirmed ||
                  !draft.reason ||
                  check?.blockers.length > 0
                }
                onClick={() =>
                  void command(`/onboarding-sessions/${sessionId}/activate`, {
                    confirmed: true,
                    reason: draft.reason,
                  })
                }
              >
                Ativar identidade
              </button>
            </>
          )}
          <details>
            <summary>Tarefas delegadas ({check?.tasks.length || 0})</summary>
            {check?.tasks.map((task: any) => (
              <div key={task.id}>
                <p>
                  {task.task_code} · {task.assignee_id} ·{" "}
                  <StatusChip status={task.status} />
                  {task.due_at &&
                    ` · ${new Date(task.due_at).toLocaleString("pt-BR")}`}
                </p>
                {task.status !== "completed" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      void command(`/onboarding-tasks/${task.id}/complete`, {
                        evidence_object_id: data.get("evidence"),
                      });
                    }}
                  >
                    <label>
                      Evidência privada
                      <input required name="evidence" />
                    </label>
                    <button disabled={busy}>Concluir tarefa</button>
                  </form>
                )}
              </div>
            ))}
          </details>
          <div className="form-actions">
            <button
              className="secondary"
              disabled={current === 0 || busy}
              onClick={() => void move(current - 1)}
            >
              Voltar
            </button>
            {current < 7 && (
              <button disabled={busy} onClick={() => void move(current + 1)}>
                Próxima etapa →
              </button>
            )}
            <button className="secondary" onClick={() => onDone(person)}>
              Abrir ficha
            </button>
          </div>
        </>
      )}
    </section>
  );
}
