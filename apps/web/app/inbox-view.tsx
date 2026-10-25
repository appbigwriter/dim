"use client";
import { useState, useEffect } from "react";
import { api } from "./client";
import { ErrorBanner, Empty, StatusChip } from "../../../packages/ui/src/index";
export default function InboxView({ organization }: { organization: string }) {
  const [conversations, setConversations] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(),
    [messages, setMessages] = useState<any[]>([]),
    [context, setContext] = useState<any>(),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [purpose, setPurpose] = useState("service"),
    [template, setTemplate] = useState(""),
    [parameters, setParameters] = useState(""),
    [tags, setTags] = useState(""),
    [contacts, setContacts] = useState<any[]>([]),
    [assignee, setAssignee] = useState(""),
    [note, setNote] = useState(""),
    [status, setStatus] = useState("open"),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setConversations([]);
    setSelected(undefined);
    setContext(undefined);
    const fetchConversations = () =>
      api(`/conversations?status=${status}&per_page=100`, organization)
        .then((r) => {
          if (active) setConversations(r.data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void fetchConversations();
    const timer = setInterval(() => {
      void fetchConversations();
      if (active) setRefresh((v) => v + 1);
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [organization, status]);
  useEffect(() => {
    if (!selected) return;
    let valid = true;
    Promise.all([
      api(`/conversations/${selected.id}/messages`, organization),
      api(`/conversations/${selected.id}/context`, organization),
      api("/contacts?per_page=100", organization),
    ])
      .then(([m, c, contacts]) => {
        if (valid) {
          setContacts(contacts.data);
          setMessages(m.data);
          setContext(c);
          setAssignee(selected.assigned_to || "");
          setError("");
        }
      })
      .catch((e) => {
        if (valid) setError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [selected, organization, refresh]);
  return (
    <section>
      {error && <ErrorBanner error={error} />}
      <div className="inbox-grid">
        <aside className="panel inbox-list">
          <h2>Conversas</h2>
          <select
            aria-label="Estado das conversas"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="open">Abertas</option>
            <option value="closed">Encerradas</option>
          </select>
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`conversation-row ${selected?.id === c.id ? "selected" : ""}`}
              onClick={() => {
                setSelected(c);
                setTags((c.tags || []).join(", "));
                setMessages([]);
                setContext(undefined);
              }}
            >
              <strong>
                {c.contact_name || c.external_thread_id || "Conversa"}
              </strong>
              <small>{c.external_thread_id || c.id.slice(0, 8)}</small>
              <StatusChip status={c.status} />
              <small>
                {c.unread_count || 0} não lidas · {(c.tags || []).join(" · ")}
              </small>
            </button>
          ))}
          {!conversations.length && (
            <Empty
              title="Inbox em dia"
              description="Mensagens autenticadas aparecerão aqui."
            />
          )}
        </aside>
        <section className="panel inbox-chat">
          {selected ? (
            <>
              <div className="panel-heading">
                <h2>{selected.contact_name || "Conversa"}</h2>
                <StatusChip status={selected.status} />
              </div>
              <small>
                Conta: {selected.social_account_id} · Identidade:{" "}
                {selected.influencer_id}
              </small>
              <div className="chat-messages">
                {messages.map((m) => (
                  <article key={m.id} className={`message ${m.direction}`}>
                    <p>{m.body_reference}</p>
                    <small>
                      {new Date(m.occurred_at).toLocaleString("pt-BR")} ·{" "}
                      {m.status}
                    </small>
                  </article>
                ))}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await api(
                      `/conversations/${selected.id}/messages`,
                      organization,
                      "POST",
                      {
                        text,
                        purpose,
                        ...(template
                          ? {
                              template_id: template,
                              template_parameters: parameters
                                ? parameters.split("\n")
                                : [],
                            }
                          : {}),
                      },
                      crypto.randomUUID(),
                    );
                    setText("");
                    setRefresh((v) => v + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Resposta
                  <textarea
                    required
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Finalidade
                    <select
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                    >
                      <option value="service">Atendimento</option>
                      <option value="marketing">Marketing com opt-in</option>
                    </select>
                  </label>
                  <label>
                    Template aprovado
                    <select
                      value={template}
                      onChange={(e) => setTemplate(e.target.value)}
                    >
                      <option value="">Mensagem livre, quando permitida</option>
                      {context?.templates.map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.provider_template_id} · {t.language}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {template && (
                  <label>
                    Variáveis do template (uma por linha, na ordem)
                    <textarea
                      value={parameters}
                      onChange={(e) => setParameters(e.target.value)}
                    />
                  </label>
                )}
                <button disabled={busy}>
                  {busy ? "Enviando à fila…" : "Enviar resposta"}
                </button>
                <small>
                  O worker confere consentimento e permissões novamente antes do
                  envio.
                </small>
              </form>
            </>
          ) : (
            <Empty
              title="Selecione uma conversa"
              description="O histórico e as ações de atendimento ficam aqui."
            />
          )}
        </section>
        <aside className="panel inbox-context">
          <h2>Contato & atendimento</h2>
          {context && (
            <>
              <h3>{context.contact.display_name}</h3>
              <details>
                <summary>Vincular contato duplicado</summary>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const data = new FormData(e.currentTarget);
                      await api(
                        `/contacts/${context.contact.id}/merge`,
                        organization,
                        "POST",
                        {
                          target_id: data.get("target"),
                          reason: data.get("reason"),
                        },
                      );
                      setRefresh((v) => v + 1);
                      setError("");
                    } catch (error) {
                      setError((error as Error).message);
                    }
                  }}
                >
                  <p>
                    O vínculo preserva as mensagens e consentimentos de cada
                    cadastro.
                  </p>
                  <label>
                    Cadastro principal
                    <select required name="target">
                      <option value="">Selecione</option>
                      {contacts
                        .filter(
                          (c) =>
                            c.id !== context.contact.id && !c.merged_into_id,
                        )
                        .map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.display_name || c.id}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Motivo
                    <textarea name="reason" required />
                  </label>
                  <button>Confirmar vínculo manual</button>
                </form>
              </details>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(
                      `/conversations/${selected.id}/preferences`,
                      organization,
                      "POST",
                      {
                        tags: tags
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                        mark_read: true,
                      },
                    );
                    setRefresh((v) => v + 1);
                    setError("");
                  } catch (error) {
                    setError((error as Error).message);
                  }
                }}
              >
                <label>
                  Tags separadas por vírgula
                  <input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </label>
                <button>Salvar tags e marcar como lida</button>
              </form>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    const result = await api(
                      `/contacts/${context.contact.id}/export`,
                      organization,
                    );
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(result, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `contato-${context.contact.id}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                  } catch (error) {
                    setError((error as Error).message);
                  }
                }}
              >
                Exportar dados do contato
              </button>
              <details>
                <summary>Solicitação do titular</summary>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const data = new FormData(e.currentTarget);
                      await api(
                        `/contacts/${context.contact.id}/privacy-request`,
                        organization,
                        "POST",
                        {
                          request_type: data.get("type"),
                          reason: data.get("reason"),
                        },
                      );
                      setError("Solicitação registrada para revisão humana.");
                    } catch (error) {
                      setError((error as Error).message);
                    }
                  }}
                >
                  <label>
                    Solicitação
                    <select name="type">
                      <option value="access">Acesso</option>
                      <option value="correction">Correção</option>
                      <option value="erasure">Exclusão</option>
                      <option value="restriction">Restrição</option>
                    </select>
                  </label>
                  <label>
                    Justificativa
                    <textarea required name="reason" />
                  </label>
                  <button>Registrar solicitação</button>
                </form>
              </details>
              <small>
                {context.contact.locale} · {context.contact.status}
              </small>
              <p className="muted">
                SLA: {context.sla_hours}h ·{" "}
                {Math.round(
                  (Date.now() - new Date(context.opened_at).getTime()) /
                    3600000,
                )}
                h desde a abertura
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(
                      `/conversations/${selected.id}/handoff`,
                      organization,
                      "POST",
                      {
                        assigned_to: assignee,
                        status: selected.status,
                        note: note || undefined,
                      },
                    );
                    setNote("");
                    setRefresh((v) => v + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label>
                  Responsável
                  <select
                    required
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {context.team.map((m: any) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.display_name || m.user_id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nota interna
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                  />
                </label>
                <button className="secondary">
                  Transferir / registrar nota
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api(
                        `/conversations/${selected.id}/handoff`,
                        organization,
                        "POST",
                        { assigned_to: assignee, status: "closed" },
                      );
                      setSelected(undefined);
                      setStatus("closed");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Encerrar conversa
                </button>
              </form>
              {context.notes.map((n: any, i: number) => (
                <p className="internal-note" key={i}>
                  {n.note_body}
                  <small>
                    {new Date(n.created_at).toLocaleString("pt-BR")}
                  </small>
                </p>
              ))}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
