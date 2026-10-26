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
    [subject, setSubject] = useState(""),
    [purpose, setPurpose] = useState("service"),
    [template, setTemplate] = useState(""),
    [parameters, setParameters] = useState(""),
    [tags, setTags] = useState(""),
    [contacts, setContacts] = useState<any[]>([]),
    [assignee, setAssignee] = useState(""),
    [note, setNote] = useState(""),
    [status, setStatus] = useState("open"),
    [filterQuery, setFilterQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0),
    [info, setInfo] = useState(""),
    [catalogs, setCatalogs] = useState<{
      identities: any[];
      accounts: any[];
      contacts: any[];
      team: any[];
    }>({ identities: [], accounts: [], contacts: [], team: [] }),
    [escalation, setEscalation] = useState({
      enabled: false,
      after_minutes: 30,
      assigned_to: "",
    }),
    [headerValue, setHeaderValue] = useState(""),
    [headerFilename, setHeaderFilename] = useState(""),
    [buttonValues, setButtonValues] = useState<Record<number, string>>({}),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setConversations([]);
    setSelected(undefined);
    setContext(undefined);
    const fetchConversations = () =>
      api(
        `/inbox/conversations?status=${status}&limit=50&offset=${offset}${filterQuery ? `&${filterQuery}` : ""}`,
        organization,
      )
        .then((r) => {
          if (active) {
            setConversations(r.data);
            setTotal(r.total);
          }
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
  }, [organization, status, filterQuery, offset]);
  useEffect(() => {
    let active = true;
    setCatalogs({ identities: [], accounts: [], contacts: [], team: [] });
    setEscalation({ enabled: false, after_minutes: 30, assigned_to: "" });
    api("/settings/inbox-escalation", organization)
      .then((policy) => {
        if (active)
          setEscalation({
            enabled: Boolean(policy.enabled),
            after_minutes: policy.after_minutes ?? 30,
            assigned_to: policy.assigned_to || "",
          });
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    Promise.allSettled([
      api("/influencers?per_page=100", organization),
      api("/accounts?per_page=100", organization),
      api("/contacts?per_page=100", organization),
      api("/users?per_page=100", organization),
    ]).then((results) => {
      if (active)
        setCatalogs({
          identities:
            results[0].status === "fulfilled" ? results[0].value.data : [],
          accounts:
            results[1].status === "fulfilled" ? results[1].value.data : [],
          contacts:
            results[2].status === "fulfilled" ? results[2].value.data : [],
          team: results[3].status === "fulfilled" ? results[3].value.data : [],
        });
    });
    return () => {
      active = false;
    };
  }, [organization]);
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
  const selectedTemplate = context?.templates?.find(
    (item: any) => item.id === template,
  );
  const templateDefinitions = selectedTemplate?.components || [];
  const bodyDefinition = templateDefinitions.find(
    (item: any) => item.type === "BODY",
  );
  const bodyPositions = [
    ...new Set(
      [...String(bodyDefinition?.text || "").matchAll(/\{\{(\d+)\}\}/g)].map(
        (match) => Number(match[1]),
      ),
    ),
  ].sort((a, b) => a - b);
  const headerDefinition = templateDefinitions.find(
    (item: any) => item.type === "HEADER",
  );
  const dynamicHeader =
    headerDefinition &&
    (headerDefinition.format !== "TEXT" ||
      /\{\{/.test(headerDefinition.text || ""));
  const buttons =
    templateDefinitions.find((item: any) => item.type === "BUTTONS")?.buttons ||
    [];
  const unsupportedTemplate = templateDefinitions.some(
    (item: any) =>
      !["BODY", "HEADER", "FOOTER", "BUTTONS"].includes(item.type) ||
      /\{\{[^0-9]/.test(item.text || ""),
  );
  const team = context?.team || catalogs.team;
  async function adminAction(path: string, body: any, message: string) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const result = await api(path, organization, "POST", body);
      setInfo(
        message +
          (typeof result.escalated === "number"
            ? ` ${result.escalated} conversa(s).`
            : ""),
      );
      setRefresh((value) => value + 1);
      if (typeof result.escalated === "number") {
        const list = await api(
          `/inbox/conversations?status=${status}&limit=50&offset=${offset}${filterQuery ? `&${filterQuery}` : ""}`,
          organization,
        );
        setConversations(list.data);
        setTotal(list.total);
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      {error && <ErrorBanner error={error} />}
      {info && <p role="status">{info}</p>}
      <details className="panel">
        <summary>Filtrar conversas</summary>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const query = new URLSearchParams();
            for (const [key, value] of form.entries())
              if (String(value))
                query.set(
                  key,
                  key === "since" || key === "until"
                    ? `${value}T${key === "since" ? "00:00:00.000" : "23:59:59.999"}Z`
                    : String(value),
                );
            setOffset(0);
            setFilterQuery(query.toString());
          }}
        >
          <label>
            Identidade
            <select name="influencer_id">
              <option value="">Todas permitidas</option>
              {catalogs.identities.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.public_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conta
            <select name="social_account_id">
              <option value="">Todas permitidas</option>
              {catalogs.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.handle ||
                    a.display_name ||
                    a.external_id ||
                    a.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contato
            <select name="contact_id">
              <option value="">Todos</option>
              {catalogs.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name || c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Canal
            <select name="channel">
              <option value="">Todos</option>
              {[
                "whatsapp",
                "telegram",
                "email",
                "instagram",
                "facebook",
                "x",
                "youtube",
                "blog",
                "crm",
              ].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Responsável
            <select name="assigned_to">
              <option value="">Todos</option>
              {team.map((m: any) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name ||
                    m.invitation_email ||
                    m.user_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Atribuição
            <select name="unassigned">
              <option value="">Todas</option>
              <option value="true">Sem responsável</option>
              <option value="false">Com responsável</option>
            </select>
          </label>
          <label>
            Leitura
            <select name="unread">
              <option value="">Todas</option>
              <option value="true">Com mensagens não lidas</option>
              <option value="false">Lidas</option>
            </select>
          </label>
          <label>
            SLA
            <select name="sla">
              <option value="">Todos</option>
              <option value="overdue">Vencido</option>
              <option value="pending">Dentro do prazo</option>
              <option value="none">Sem prazo</option>
            </select>
          </label>
          <label>
            Tag
            <input name="tag" maxLength={40} />
          </label>
          <label>
            Nome do contato
            <input name="search" maxLength={160} />
          </label>
          <label>
            Desde (UTC)
            <input name="since" type="date" />
          </label>
          <label>
            Até (UTC)
            <input name="until" type="date" />
          </label>
          <button>Aplicar filtros</button>
          <button
            type="reset"
            className="secondary"
            onClick={() => {
              setFilterQuery("");
              setOffset(0);
            }}
          >
            Limpar filtros
          </button>
        </form>
      </details>
      <details className="panel">
        <summary>Política e escalonamento de SLA</summary>
        <p>
          A configuração exige permissão administrativa e MFA. O processamento
          usa suas permissões de atendimento; nenhuma mensagem é enviada.
        </p>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void adminAction(
              "/settings/inbox-escalation",
              {
                enabled: form.get("enabled") === "on",
                after_minutes: Number(form.get("after_minutes")),
                assigned_to: form.get("assigned_to"),
              },
              "Política de escalonamento salva.",
            );
          }}
        >
          <label>
            <input
              type="checkbox"
              name="enabled"
              checked={escalation.enabled}
              onChange={(event) =>
                setEscalation((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
            />
            Habilitar política
          </label>
          <label>
            Minutos após o vencimento
            <input
              type="number"
              name="after_minutes"
              min={0}
              max={43200}
              value={escalation.after_minutes}
              onChange={(event) =>
                setEscalation((current) => ({
                  ...current,
                  after_minutes: Number(event.target.value),
                }))
              }
              required
            />
          </label>
          <label>
            Responsável de escalonamento
            <select
              name="assigned_to"
              required
              value={escalation.assigned_to}
              onChange={(event) =>
                setEscalation((current) => ({
                  ...current,
                  assigned_to: event.target.value,
                }))
              }
            >
              <option value="">Selecione</option>
              {team.map((m: any) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name ||
                    m.invitation_email ||
                    m.user_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>Salvar política com MFA</button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void adminAction(
                "/inbox/escalate",
                {},
                "Escalonamento processado.",
              )
            }
          >
            Processar SLA vencido agora
          </button>
        </form>
        <small>
          O processamento automático depende do agendamento autenticado no
          ambiente.
        </small>
      </details>
      <div className="inbox-grid">
        <aside className="panel inbox-list">
          <h2>Conversas</h2>
          <select
            aria-label="Estado das conversas"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
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
                setSubject("");
                setTemplate("");
                setHeaderValue("");
                setHeaderFilename("");
                setButtonValues({});
                setParameters("");
                setInfo("");
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
          <p>
            {conversations.length} conversa(s) nesta página · {total} no filtro
          </p>
          <div className="toolbar">
            <button
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 50))}
            >
              Anterior
            </button>
            <button
              disabled={conversations.length < 50}
              onClick={() => setOffset((value) => value + 50)}
            >
              Próxima
            </button>
          </div>
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
                      selected.channel === "email"
                        ? `/conversations/${selected.id}/email/send`
                        : `/conversations/${selected.id}/messages`,
                      organization,
                      "POST",
                      {
                        ...(selected.channel === "email" ? { subject } : {}),
                        text,
                        purpose,
                        ...(template
                          ? {
                              template_id: template,
                              template_parameters: parameters
                                ? parameters.split("\n")
                                : [],
                              template_components: {
                                ...(dynamicHeader
                                  ? {
                                      header:
                                        headerDefinition.format === "TEXT"
                                          ? { type: "text", text: headerValue }
                                          : {
                                              type: headerDefinition.format.toLowerCase(),
                                              id: headerValue,
                                              ...(headerFilename
                                                ? { filename: headerFilename }
                                                : {}),
                                            },
                                    }
                                  : {}),
                                buttons: buttons.flatMap(
                                  (button: any, index: number) =>
                                    button.type === "QUICK_REPLY" ||
                                    (button.type === "URL" &&
                                      /\{\{/.test(button.url || ""))
                                      ? [
                                          {
                                            index,
                                            type:
                                              button.type === "URL"
                                                ? "url"
                                                : "quick_reply",
                                            value: buttonValues[index] || "",
                                          },
                                        ]
                                      : [],
                                ),
                              },
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
                {selected.channel === "email" && (
                  <label>
                    Assunto do e-mail
                    <input
                      required
                      maxLength={998}
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                    />
                  </label>
                )}
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
                  {selected.channel !== "email" && (
                    <label>
                      Template aprovado
                      <select
                        value={template}
                        onChange={(e) => {
                          setTemplate(e.target.value);
                          setParameters("");
                          setHeaderValue("");
                          setHeaderFilename("");
                          setButtonValues({});
                        }}
                      >
                        <option value="">
                          Mensagem livre, quando permitida
                        </option>
                        {context?.templates.map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.provider_template_id} · {t.language}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {template && (
                  <fieldset>
                    <legend>Parâmetros do template aprovado</legend>
                    {unsupportedTemplate && (
                      <p role="alert">
                        Este template usa componentes ainda não habilitados.
                        Escolha outro template.
                      </p>
                    )}
                    {bodyPositions.map((position) => (
                      <label key={position}>
                        Variável BODY {position}
                        <input
                          required
                          value={parameters.split("\n")[position - 1] || ""}
                          onChange={(event) => {
                            const next = parameters.split("\n");
                            next[position - 1] = event.target.value;
                            setParameters(next.join("\n"));
                          }}
                        />
                      </label>
                    ))}
                    {dynamicHeader && (
                      <label>
                        {headerDefinition.format === "TEXT"
                          ? "Texto variável do cabeçalho"
                          : `ID da mídia ${headerDefinition.format.toLowerCase()} já enviada ao WhatsApp`}
                        <input
                          required
                          value={headerValue}
                          pattern={
                            headerDefinition.format === "TEXT"
                              ? undefined
                              : "[0-9]{1,80}"
                          }
                          maxLength={
                            headerDefinition.format === "TEXT" ? 60 : 80
                          }
                          onChange={(event) =>
                            setHeaderValue(event.target.value)
                          }
                        />
                      </label>
                    )}
                    {dynamicHeader &&
                      headerDefinition.format === "DOCUMENT" && (
                        <label>
                          Nome do documento (opcional)
                          <input
                            value={headerFilename}
                            maxLength={240}
                            onChange={(event) =>
                              setHeaderFilename(event.target.value)
                            }
                          />
                        </label>
                      )}
                    {buttons.map((button: any, index: number) =>
                      button.type === "QUICK_REPLY" ||
                      (button.type === "URL" &&
                        /\{\{/.test(button.url || "")) ? (
                        <label key={index}>
                          Botão {index + 1}: {button.text} ·{" "}
                          {button.type === "URL"
                            ? "sufixo da URL aprovada"
                            : "valor de retorno"}
                          <input
                            required
                            maxLength={2048}
                            value={buttonValues[index] || ""}
                            onChange={(event) =>
                              setButtonValues((current) => ({
                                ...current,
                                [index]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ) : null,
                    )}
                    {!bodyPositions.length &&
                      !dynamicHeader &&
                      !buttons.length && (
                        <p>Este template não recebe variáveis.</p>
                      )}
                  </fieldset>
                )}
                <button disabled={busy || unsupportedTemplate}>
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
                      setInfo(
                        "Solicitação registrada para revisão humana por outro responsável com MFA.",
                      );
                      setError("");
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
