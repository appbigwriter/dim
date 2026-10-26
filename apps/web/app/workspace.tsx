"use client";
import AudiencePanel from "./audience-panel";
import AccountConnect from "./account-connect";
import IdentityProfile from "./identity-profile";
import ContentComparison from "./content-comparison";
import ChannelCoverage from "./channel-coverage";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import {
  api,
  authClient,
  getSimpleToken,
  setSimpleToken,
  clearSimpleToken,
} from "./client";
import { ResourceForm, JsonCommand, UploadPanel } from "./forms";
import AnalyticsView from "./analytics-view";
import AccessPanel from "./access-panel";
import Wizard from "./onboarding-wizard";
import CalendarView from "./calendar-view";
import InboxView from "./inbox-view";
import VersionDiff from "./version-diff";
import {
  StatusChip,
  ErrorBanner,
  Empty,
  Metric,
} from "../../../packages/ui/src/index";
const sections = [
  {
    title: "VISÃO GERAL",
    links: [
      ["/dashboard", "◫", "Dashboard"],
      ["/influencers", "◎", "Influenciadores"],
      ["/accounts", "↗", "Contas & canais"],
    ],
  },
  {
    title: "OPERAÇÃO",
    links: [
      ["/studio", "▤", "Content Studio"],
      ["/approvals", "✓", "Aprovações"],
      ["/editorial/calendar", "▦", "Calendário"],
      ["/publications", "➚", "Publicações"],
      ["/inbox", "▱", "Inbox"],
      ["/campaigns", "◇", "Campanhas"],
    ],
  },
  {
    title: "GESTÃO",
    links: [
      ["/governance", "◈", "Governança"],
      ["/agents", "✳", "Agentes"],
      ["/analytics", "▥", "Analytics"],
      ["/settings/users", "⚙", "Configurações"],
      ["/security/audit", "≡", "Auditoria"],
    ],
  },
];
const moduleMap: Record<string, string> = {
  "/influencers": "influencers",
  "/accounts": "accounts",
  "/studio": "contents",
  "/approvals": "approvals",
  "/publications": "publications",
  "/inbox": "conversations",
  "/contacts": "contacts",
  "/consents": "consents",
  "/templates": "templates",
  "/campaigns": "campaigns",
  "/governance": "contracts",
  "/contracts": "contracts",
  "/assets": "assets",
  "/media": "assets",
  "/disclosures": "disclosures",
  "/agents": "agent-assignments",
  "/agents/runs": "agent-runs",
  "/editorial/topics": "topics",
  "/settings/users": "users",
  "/settings/roles": "roles",
  "/settings/teams": "teams",
  "/settings/policies": "policies",
  "/security/audit": "audit",
  "/security/incidents": "incidents",
  "/partners": "partners",
  "/revenues": "revenues",
  "/costs": "costs",
  "/licenses": "licenses",
  "/legal-parties": "legal-parties",
  "/model-configs": "model-configs",
  "/onboarding-tasks": "onboarding-tasks",
  "/account-tasks": "account-tasks",
  "/identity-consents": "identity-consents",
};
const titles: Record<string, string> = {
  "/dashboard": "Sua operação, em perspectiva.",
  "/influencers": "Influenciadores",
  "/accounts": "Contas & canais",
  "/studio": "Content Studio",
  "/approvals": "Central de aprovações",
  "/publications": "Publicações",
  "/inbox": "Inbox",
  "/campaigns": "Campanhas",
  "/governance": "Governança & direitos",
  "/agents": "Agentes & automação",
  "/analytics": "Resultados com origem",
  "/editorial/calendar": "Calendário editorial",
  "/settings/users": "Equipe & acessos",
  "/security/audit": "Trilha de auditoria",
};
const subtitles: Record<string, string> = {
  "/dashboard": "Identidades, conteúdo e relacionamento em um único espaço.",
  "/influencers":
    "Pessoas e personagens. Cada identidade com sua própria governança.",
  "/studio": "Da pauta à versão aprovada, com rastreabilidade.",
  "/accounts": "Conexões oficiais e permissões verificadas por conta.",
  "/inbox": "Atendimento humano, consentimento e contexto por canal.",
  "/governance":
    "Titularidade, contratos e autorizações para operar com segurança.",
};
function Login({ onSession }: { onSession: () => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [factor, setFactor] = useState(""),
    [qr, setQr] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function completeLogin() {
    onSession();
    if (location.pathname === "/login") location.assign("/dashboard");
  }

  async function handleLogin(targetEmail?: string, targetPassword?: string) {
    setBusy(true);
    setError("");
    const em = (targetEmail || email).trim();
    const pw = targetPassword || password;

    try {
      const res = await fetch("/api/v1/auth/simple-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, password: pw }),
      }).catch(() => null);

      if (res?.ok) {
        const data = await res.json();
        if (data.token) {
          setSimpleToken(data.token);
          if (data.organizations?.[0]?.id) {
            localStorage.setItem("dim.organization", data.organizations[0].id);
          }
          completeLogin();
          return;
        }
      } else if (res && res.status === 401) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || "Credenciais inválidas");
      } else if (res && res.status === 503) {
        throw new Error(
          "A API interna ainda está inicializando na VPS. Aguarde alguns instantes e tente novamente.",
        );
      }

      const client = authClient();
      if (factor) {
        const result = await client.auth.mfa.challengeAndVerify({
          factorId: factor,
          code,
        });
        if (result.error) throw result.error;
        completeLogin();
        return;
      }
      const result = await client.auth.signInWithPassword({
        email: em,
        password: pw,
      });
      if (result.error) throw result.error;
      const factors = await client.auth.mfa.listFactors();
      const totp = factors.data?.totp.find((f: any) => f.status === "verified");
      if (totp) {
        setFactor(totp.id);
        return;
      }
      completeLogin();
    } catch (e) {
      setError((e as Error).message || "Falha na autenticação");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void handleLogin();
  }

  async function enroll() {
    try {
      const result = await authClient().auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `DIM ${Date.now()}`,
      });
      if (result.error) throw result.error;
      setFactor(result.data.id);
      setQr(result.data.totp.qr_code);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <Link href="/" className="brand">
          <b>D</b> DIM<span>INFLUENCER MANAGEMENT</span>
        </Link>
        <div>
          <span className="eyebrow">IDENTIDADE. CONTEÚDO. CONTINUIDADE.</span>
          <h1>
            Grandes vozes.
            <br />
            Uma operação
            <br />
            <em>bem cuidada.</em>
          </h1>
          <p>
            O espaço de gestão para quem constrói influência com
            responsabilidade.
          </p>
        </div>
        <small>FBR · Digital Influencer Management</small>
      </section>
      <section className="login-form">
        <span className="eyebrow">SEU ESPAÇO DE TRABALHO</span>
        <h2>Bem-vindo ao DIM.</h2>
        <p>Entre com sua conta corporativa para continuar.</p>
        {error && <ErrorBanner error={error} />}
        <form onSubmit={submit}>
          {!factor ? (
            <>
              <label>
                E-mail
                <input
                  autoComplete="username"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Senha
                <input
                  autoComplete="current-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              {qr && (
                <img
                  src={qr}
                  alt="QR code para configurar seu segundo fator"
                  width={200}
                  height={200}
                />
              )}
              <label>
                Código do autenticador
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            </>
          )}
          <button className="primary" disabled={busy} type="submit">
            {busy
              ? "Entrando…"
              : factor
                ? "Confirmar segundo fator"
                : "Entrar no espaço →"}
          </button>
        </form>
        <button className="text-button" onClick={enroll}>
          Configurar MFA
        </button>
        <small>Administradores precisam de autenticação em dois fatores.</small>
        <footer>
          <Link href="/privacy">Privacidade</Link>
          <Link href="/terms">Termos</Link>
        </footer>
      </section>
    </main>
  );
}
function Detail({
  id,
  kind,
  organization,
  onBack,
}: {
  id: string;
  kind: string;
  organization: string;
  onBack: () => void;
}) {
  const [item, setItem] = useState<any>(),
    [data, setData] = useState<any[]>([]),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [tab, setTab] = useState("summary"),
    [body, setBody] = useState(""),
    [when, setWhen] = useState(""),
    [account, setAccount] = useState(""),
    [accounts, setAccounts] = useState<any[]>([]),
    [health, setHealth] = useState<any>(),
    [chosen, setChosen] = useState("");
  const endpoint =
    kind === "influencers"
      ? "influencers"
      : kind === "accounts"
        ? "accounts"
        : kind === "conversations"
          ? "conversations"
          : "contents";
  useEffect(() => {
    let valid = true;
    (async () => {
      try {
        const detail = await api(`/${endpoint}/${id}`, organization);
        if (!valid) return;
        setItem(detail);
        const path =
          kind === "influencers"
            ? tab === "persona"
              ? `/influencers/${id}/personas`
              : tab === "history"
                ? `/influencers/${id}/history`
                : tab === "governance"
                  ? `/contracts?influencer_id=${id}`
                  : `/influencers/${id}/blockers`
            : kind === "contents"
              ? `/contents/${id}/versions`
              : kind === "accounts"
                ? `/accounts/${id}/capabilities`
                : `/conversations/${id}/messages`;
        const rows = await api(path, organization);
        if (!valid) return;
        if (kind === "accounts")
          setItem({ ...detail, provider: rows.provider });
        setData(rows.data || [rows]);
        if (kind === "contents") {
          setChosen(rows.data?.[0]?.id || "");
          const a = await api(
            `/accounts?influencer_id=${detail.influencer_id}`,
            organization,
          );
          if (valid) setAccounts(a.data);
        }
        setError("");
      } catch (e) {
        if (valid) setError((e as Error).message);
      }
    })();
    return () => {
      valid = false;
    };
  }, [id, kind, organization, refresh, tab]);
  const command = async (path: string, data: any) => {
    const result = await api(
      path,
      organization,
      "POST",
      data,
      crypto.randomUUID(),
    );
    setRefresh((v) => v + 1);
    return result;
  };
  return (
    <section className="detail">
      <button className="text-button" onClick={onBack}>
        ← Voltar à lista
      </button>
      {error && <ErrorBanner error={error} />}
      <h2>{item?.public_name || item?.title || item?.handle || "Detalhes"}</h2>
      {item && (
        <>
          <div className="identity-meta">
            <StatusChip status={item.status || item.account_status || "open"} />
            <code>{item.id}</code>
          </div>
          {kind === "influencers" && (
            <>
              <IdentityProfile
                organization={organization}
                id={id}
                onSaved={() => setRefresh((value) => value + 1)}
              />
              <AudiencePanel organization={organization} id={id} />
              <ChannelCoverage organization={organization} id={id} />
              <nav className="tabs">
                {[
                  ["summary", "Resumo"],
                  ["persona", "Persona"],
                  ["governance", "Contratos"],
                  ["history", "Histórico"],
                ].map(([key, name]) => (
                  <button
                    key={key}
                    className={tab === key ? "selected" : ""}
                    onClick={() => setTab(key)}
                  >
                    {name}
                  </button>
                ))}
              </nav>
              <div className="command-row">
                <JsonCommand
                  title="Executar checklist ou auditoria"
                  initial={{ workflow: "identity.audit", subject_id: id }}
                  submit={(data) => command("/workflows", data)}
                />
                {item.persona_source === "legacy_local" && (
                  <>
                    <JsonCommand
                      title="Nova versão da persona"
                      initial={{
                        public_bio: "",
                        tone: {},
                        traits: {},
                        knowledge: {},
                        boundaries: {},
                        approval_status: "draft",
                      }}
                      submit={(data) =>
                        command(`/influencers/${id}/personas`, data)
                      }
                    />
                  </>
                )}
                <Link
                  className="button secondary"
                  href={`/influencers/${id}/onboarding`}
                >
                  Retomar onboarding
                </Link>
              </div>
            </>
          )}
          {kind === "contents" && (
            <>
              <form
                className="panel"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await command(`/contents/${id}/versions`, {
                      body_text: body,
                      language: "pt-BR",
                      format: item.content_type,
                      body: {},
                      source_urls: [],
                      asset_ids: [],
                    });
                    setBody("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label>
                  Nova versão
                  <textarea
                    value={body}
                    required
                    onChange={(e) => setBody(e.target.value)}
                    rows={6}
                  />
                </label>
                <button>Salvar versão imutável</button>
                <small>
                  Inclua fontes na ação avançada abaixo antes de solicitar
                  aprovação.
                </small>
              </form>
              <div className="command-row">
                <JsonCommand
                  title="Versão com fontes e mídia"
                  initial={{
                    body_text: "",
                    language: "pt-BR",
                    format: item.content_type,
                    body: {},
                    source_urls: [],
                    asset_ids: [],
                  }}
                  submit={(data) => command(`/contents/${id}/versions`, data)}
                />
                <JsonCommand
                  title="Conferir alegações e evidências"
                  initial={{
                    claims: [
                      {
                        claim: "",
                        sourceUrl: "https://",
                        quote: "",
                        decision: "supported",
                        reason: "",
                      },
                    ],
                  }}
                  submit={(value) =>
                    command(`/content-versions/${chosen}/fact-review`, value)
                  }
                />
                <JsonCommand
                  title="Aprovar / solicitar alteração"
                  initial={{
                    content_version_id: chosen,
                    decision: "approved",
                    rationale: "",
                  }}
                  submit={(data) => command(`/contents/${id}/approvals`, data)}
                />
              </div>
              <form
                className="panel form-grid"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await command("/publications", {
                      social_account_id: account,
                      content_version_id: chosen,
                      scheduled_at: new Date(when).toISOString(),
                    });
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label>
                  Versão exata
                  <select
                    required
                    value={chosen}
                    onChange={(e) => setChosen(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {data.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version_number} · {v.language}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Destino
                  <select
                    required
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                  >
                    <option value="">Conta autorizada</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.handle}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Horário local
                  <input
                    required
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                </label>
                <button>Agendar versão aprovada</button>
              </form>
            </>
          )}
          {kind === "accounts" && (
            <AccountConnect
              organization={organization}
              accountId={id}
              provider={
                item.platform_code ||
                item.provider ||
                accounts.find((a) => a.id === id)?.platform_code ||
                ""
              }
              onConnected={() => setRefresh((v) => v + 1)}
            />
          )}
          {kind === "accounts" && (
            <section className="panel">
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    const result = await api(
                      `/accounts/${id}/health`,
                      organization,
                    );
                    setHealth({ account_id: id, result });
                    setRefresh((v) => v + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Verificar conexão e capacidades
              </button>
              {health?.account_id === id && (
                <pre>{JSON.stringify(health.result, null, 2)}</pre>
              )}
            </section>
          )}
          {kind === "accounts" &&
            ["telegram", "whatsapp", "cms", "email"].includes(
              item.provider,
            ) && (
              <JsonCommand
                title={`Conectar ${item.provider} pelo cofre`}
                initial={{ secret_ref: "" }}
                submit={(data) => command(`/accounts/${id}/connect`, data)}
              />
            )}{" "}
          {kind === "conversations" && (
            <>
              <form
                className="panel"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await command(`/conversations/${id}/messages`, {
                      text: body,
                      purpose: "service",
                    });
                    setBody("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label>
                  Resposta humana
                  <textarea
                    required
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </label>
                <button>Enviar resposta</button>
              </form>
              <JsonCommand
                title="Transferir / encerrar / nota interna"
                initial={{ assigned_to: "", status: "open", note: "" }}
                submit={(data) => command(`/conversations/${id}/handoff`, data)}
              />
            </>
          )}
          {kind === "contents" && (
            <ContentComparison
              key={`${id}:${refresh}`}
              organization={organization}
              id={id}
            />
          )}
          {kind === "influencers" && tab === "persona" && (
            <VersionDiff
              organization={organization}
              endpoint={`/influencers/${id}/personas/compare`}
            />
          )}
          <div className="records">
            {data.map((entry, i) => (
              <article className="panel" key={entry.id || i}>
                {entry.version_number && <h3>Versão {entry.version_number}</h3>}
                {entry.body_text && (
                  <p className="content-text">{entry.body_text}</p>
                )}
                {entry.body_reference && (
                  <p className="content-text">{entry.body_reference}</p>
                )}
                <pre>{JSON.stringify(entry, null, 2)}</pre>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
export default function Workspace({ path }: { path: string }) {
  const [session, setSession] = useState(false),
    [checking, setChecking] = useState(true),
    [org, setOrg] = useState(""),
    [organizations, setOrganizations] = useState<any[]>([]),
    [error, setError] = useState(""),
    [data, setData] = useState<any>(),
    [forms, setForms] = useState<any>({}),
    [loading, setLoading] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [creating, setCreating] = useState(path.endsWith("/new")),
    [detail, setDetail] = useState(""),
    [menu, setMenu] = useState(false),
    [locale, setLocale] = useState("pt-BR");
  const loadSession = useCallback(async () => {
    try {
      const token = getSimpleToken();
      if (!token) {
        const { data } = await authClient().auth.getSession();
        if (!data.session) {
          setSession(false);
          return;
        }
      }
      const response = await api("/session", "");
      setOrganizations(response.organizations || []);
      setSession(true);
      const stored = localStorage.getItem("dim.organization");
      const activeOrganization =
        response.organizations?.find((o: any) => o.id === stored)?.id ||
        response.organizations?.[0]?.id;
      if (activeOrganization)
        void api("/me", activeOrganization).catch(() => {});
      setOrg(activeOrganization || "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void loadSession();
    let subscription: any;
    try {
      subscription = (authClient().auth as any).onAuthStateChange(
        (event: string) => {
          if (event === "SIGNED_OUT") setSession(false);
        },
      ).data.subscription;
    } catch {
      /* missing environment appears at login */
    }
    return () => subscription?.unsubscribe();
  }, [loadSession]);
  const base = path.replace(/\/new$/, "");
  const key = moduleMap[base] || moduleMap[`/${path.split("/")[1]}`];
  const identityId =
    path.startsWith("/influencers/") && !path.endsWith("/new")
      ? path.split("/")[2]
      : "";
  useEffect(() => {
    if (!session || !org) return;
    let valid = true;
    setLoading(true);
    setData(undefined);
    setError("");
    (async () => {
      try {
        const registry = await api("/forms", org);
        if (valid) setForms(registry.resources);
        const endpoint =
          path === "/dashboard"
            ? "/dashboard"
            : path === "/analytics"
              ? "/analytics/overview"
              : path === "/editorial/calendar"
                ? "/calendar"
                : path === "/connectors"
                  ? "/connectors"
                  : key
                    ? `/${key}?page=${page}&q=${encodeURIComponent(search)}${filter ? `&type=${filter}` : ""}`
                    : null;
        const result = endpoint ? await api(endpoint, org) : null;
        if (valid) setData(result);
      } catch (e) {
        if (valid) setError((e as Error).message);
      } finally {
        if (valid) setLoading(false);
      }
    })();
    return () => {
      valid = false;
    };
  }, [session, org, path, key, page, search, filter, refresh]);
  if (["/privacy", "/terms", "/about"].includes(path))
    return (
      <main className="public">
        <Link className="brand" href="/dashboard">
          <b>D</b> DIM
        </Link>
        <h1>
          {path === "/privacy"
            ? "Privacidade"
            : path === "/terms"
              ? "Termos de uso"
              : "Sobre o DIM"}
        </h1>
        <p>
          DIM é uma plataforma de gestão de identidades, conteúdo editorial,
          contas oficiais e relacionamento.
        </p>
        <p>
          {path === "/privacy"
            ? "O sistema registra identidades, contratos, consentimentos, mensagens e auditoria conforme as permissões da organização. Dados ficam no Supabase central e arquivos em armazenamento privado. Este aplicativo não inclui rastreamento de marketing."
            : path === "/terms"
              ? "O acesso exige conta autorizada. Operações dependem de permissões, direitos vigentes e autorização das plataformas. Publicações são vinculadas à versão aprovada."
              : "O projeto reúne governança, produção e operação de influenciadores humanos, virtuais e híbridos."}
        </p>
        <p className="muted">
          Validação institucional pendente: controlador, canal de contato e
          políticas de retenção devem ser definidos pela organização antes do
          lançamento.
        </p>
        <Link href="/dashboard">Voltar ao DIM</Link>
      </main>
    );
  if (checking)
    return (
      <main className="public" aria-busy="true">
        Carregando seu espaço…
      </main>
    );
  if (!session || path === "/login") return <Login onSession={loadSession} />;
  const title =
    titles[base] || base.split("/").pop()?.replaceAll("-", " ") || "DIM";
  const contentId =
    path.startsWith("/studio/") && !path.endsWith("/new")
      ? path.split("/")[2]
      : "";
  const selected = detail || identityId || contentId;
  const dataset = data?.data || [];
  const create = async (value: any) => {
    setCreating(false);
    setRefresh((v) => v + 1);
    if (
      value.id &&
      ["influencers", "contents", "accounts", "conversations"].includes(key)
    )
      setDetail(value.id);
  };
  return (
    <div className="app-shell">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <Link href="/dashboard" className="brand">
          <b>D</b> DIM<span>INFLUENCER MANAGEMENT</span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-dot" />
          FBR / Workspace<span className="chip">DIM</span>
        </div>
        {sections.map((section) => (
          <nav key={section.title} aria-label={section.title}>
            <p className="nav-title">{section.title}</p>
            {section.links.map(([href, icon, label]) => (
              <Link
                key={href}
                href={href}
                className={path === href ? "nav-link active" : "nav-link"}
                onClick={() => setMenu(false)}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
                {href === "/inbox" && <i>↗</i>}
              </Link>
            ))}
          </nav>
        ))}
        <div className="sidebar-bottom">
          <span className="live-dot" /> Governança em cada etapa
          <small>Versão 0.1 · ambiente configurado</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-toggle"
            aria-label="Abrir navegação"
            onClick={() => setMenu(!menu)}
          >
            ☰
          </button>
          <div className="breadcrumbs">
            Workspace <span>/</span>{" "}
            {path === "/dashboard" ? "Visão geral" : title}
          </div>
          <div className="topbar-actions">
            <select
              aria-label="Organização ativa"
              value={org}
              onChange={(e) => {
                setOrg(e.target.value);
                localStorage.setItem("dim.organization", e.target.value);
                setDetail("");
                setPage(1);
              }}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Idioma de formatação"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
            >
              <option value="pt-BR">PT</option>
              <option value="en">EN</option>
              <option value="es">ES</option>
            </select>
            <button
              className="avatar"
              aria-label="Sair da conta"
              title="Sair da conta"
              onClick={() => {
                clearSimpleToken();
                try {
                  void authClient().auth.signOut();
                } catch {}
                setSession(false);
              }}
            >
              ↪
            </button>
          </div>
        </header>
        <main className="main">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                DIM WORKSPACE /{" "}
                {path === "/dashboard" ? "OVERVIEW" : "OPERAÇÃO"}
              </span>
              <h1>{title}</h1>
              <p>
                {subtitles[base] ||
                  "Informação, responsabilidade e rastreabilidade em cada etapa."}
              </p>
            </div>
            {key && forms[key]?.can_create && !creating && !selected && (
              <button onClick={() => setCreating(true)}>
                +{" "}
                {key === "influencers" ? "Novo influenciador" : "Novo registro"}
              </button>
            )}
          </div>
          {!org && (
            <ErrorBanner error="Nenhuma organização atribuída. Execute o bootstrap ou solicite membership ao administrador." />
          )}
          {error && (
            <ErrorBanner error={error} retry={() => setRefresh((v) => v + 1)} />
          )}{" "}
          {loading ? (
            <div className="skeleton" aria-busy="true">
              Atualizando dados do workspace…
            </div>
          ) : selected && key && !path.endsWith("/onboarding") ? (
            <Detail
              id={selected}
              kind={key}
              organization={org}
              onBack={() => {
                setDetail("");
                if (identityId) location.assign("/influencers");
                if (contentId) location.assign("/studio");
              }}
            />
          ) : creating && forms[key] ? (
            key === "influencers" ? (
              <Wizard
                organization={org}
                schema={forms[key].schema}
                onDone={create}
              />
            ) : (
              <section className="panel">
                <h2>Novo registro</h2>
                <ResourceForm
                  organization={org}
                  endpoint={`/${key}`}
                  schema={forms[key].schema}
                  onSaved={create}
                  onCancel={() => setCreating(false)}
                />
              </section>
            )
          ) : path.endsWith("/onboarding") && identityId ? (
            <Wizard
              identity={{ id: identityId }}
              organization={org}
              schema={forms.influencers?.schema}
              onDone={create}
            />
          ) : path === "/dashboard" ? (
            <>
              <div className="overview-banner">
                <div>
                  <span className="eyebrow">CONSTRUA COM CONTINUIDADE</span>
                  <h2>
                    Cada identidade tem uma história.
                    <br />
                    Cuide de toda a operação.
                  </h2>
                  <Link href="/influencers/new" className="button">
                    Criar uma identidade <span>↗</span>
                  </Link>
                </div>
                <div className="orbit" aria-hidden="true">
                  <div />
                  <span>DIM</span>
                  <i>◎</i>
                  <b>✳</b>
                </div>
              </div>
              <div className="metrics">
                {[
                  ["influencers", "Identidades"],
                  ["accounts", "Contas digitais"],
                  ["contents", "Conteúdos"],
                  ["publications", "Publicações"],
                ].map(([k, label]) => (
                  <Metric
                    key={k}
                    label={label}
                    value={data?.counts?.[k]?.total ?? "—"}
                    source={
                      data?.counts?.[k]?.state === "permission_denied"
                        ? "Sem permissão"
                        : data?.counts?.[k]?.source ||
                          "Aguardando sincronização"
                    }
                  />
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Seu próximo movimento</h2>
                    <span className="chip">Fluxo operacional</span>
                  </div>
                  {[
                    [
                      "01",
                      "Cadastre uma identidade",
                      "Defina titularidade, persona e responsáveis.",
                      "/influencers/new",
                    ],
                    [
                      "02",
                      "Conecte seus canais",
                      "Valide as permissões de cada conta oficial.",
                      "/accounts",
                    ],
                    [
                      "03",
                      "Crie com confiança",
                      "Produza uma versão, revise e agende.",
                      "/studio",
                    ],
                  ].map(([n, t, d, href]) => (
                    <Link key={n} className="next-step" href={href}>
                      <span>{n}</span>
                      <div>
                        <h3>{t}</h3>
                        <p>{d}</p>
                      </div>
                      <b>↗</b>
                    </Link>
                  ))}
                </section>
                <section className="panel operational">
                  <span className="eyebrow">CONTROLE & RESPONSABILIDADE</span>
                  <h2>
                    Pronto para operar
                    <br />
                    com clareza.
                  </h2>
                  <p>
                    Aprovações vinculadas à versão exata. Canais com capacidades
                    verificadas. Histórico para cada decisão.
                  </p>
                  <Link href="/security/audit">Consultar auditoria →</Link>
                  <small>
                    Origem: {data?.source || "custom_dim"}
                    <br />
                    {data?.as_of && new Date(data.as_of).toLocaleString(locale)}
                  </small>
                </section>
              </div>
            </>
          ) : path === "/analytics" ? (
            <AnalyticsView organization={org} />
          ) : path === "/editorial/calendar" ? (
            <CalendarView organization={org} />
          ) : path === "/inbox" ? (
            <InboxView organization={org} />
          ) : key || path === "/connectors" ? (
            <section className="panel list-panel">
              {key === "assets" && <UploadPanel organization={org} />}
              <div className="toolbar">
                <input
                  aria-label="Buscar registros"
                  placeholder="Buscar no módulo…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
                {key === "influencers" && (
                  <select
                    aria-label="Tipo de identidade"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Todos os tipos</option>
                    <option value="human">Humano</option>
                    <option value="virtual">Virtual</option>
                    <option value="hybrid">Híbrido</option>
                  </select>
                )}
                <span className="muted">
                  {data?.total ?? dataset.length} registros
                </span>
              </div>
              {dataset.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Registro</th>
                        <th>Tipo / referência</th>
                        <th>Estado</th>
                        <th>Atualizado / criado</th>
                        <th>
                          <span className="sr-only">Ação</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataset.map((r: any) => (
                        <tr key={r.id}>
                          <td>
                            <strong>
                              {r.public_name ||
                                r.title ||
                                r.name ||
                                r.handle ||
                                r.display_name ||
                                r.action ||
                                r.task_type ||
                                r.code ||
                                r.id.slice(0, 8)}
                            </strong>
                            <small>{r.slug || r.id}</small>
                          </td>
                          <td>
                            {r.type ||
                              r.content_type ||
                              r.resource_type ||
                              r.currency ||
                              r.provider ||
                              r.scope_type ||
                              "—"}
                          </td>
                          <td>
                            <StatusChip
                              status={
                                r.status ||
                                r.account_status ||
                                r.decision ||
                                r.state ||
                                "registered"
                              }
                            />
                          </td>
                          <td>
                            {new Date(
                              r.updated_at || r.created_at,
                            ).toLocaleDateString(locale)}
                          </td>
                          <td>
                            {[
                              "influencers",
                              "contents",
                              "accounts",
                              "conversations",
                            ].includes(key) ? (
                              <button
                                className="text-button"
                                onClick={() => setDetail(r.id)}
                              >
                                Abrir ↗
                              </button>
                            ) : key === "publications" ? (
                              <button
                                className="text-button"
                                onClick={async () => {
                                  try {
                                    await api(
                                      `/publications/${r.id}/cancel`,
                                      org,
                                      "POST",
                                      {},
                                    );
                                    setRefresh((v) => v + 1);
                                  } catch (e) {
                                    setError((e as Error).message);
                                  }
                                }}
                              >
                                Cancelar
                              </button>
                            ) : ["consents", "identity-consents"].includes(
                                key,
                              ) ? (
                              <button
                                className="text-button"
                                onClick={async () => {
                                  if (
                                    !confirm(
                                      "Revogar este consentimento e preservar a evidência?",
                                    )
                                  )
                                    return;
                                  try {
                                    await api(
                                      `/${key}/${r.id}/revoke`,
                                      org,
                                      "POST",
                                      {},
                                    );
                                    setRefresh((v) => v + 1);
                                  } catch (e) {
                                    setError((e as Error).message);
                                  }
                                }}
                              >
                                Revogar
                              </button>
                            ) : (
                              <details>
                                <summary>Dados</summary>
                                <pre>{JSON.stringify(r, null, 2)}</pre>
                              </details>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty />
              )}
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  ← Anterior
                </button>
                <span>Página {page}</span>
                <button
                  className="secondary"
                  disabled={!data?.total || page * 25 >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  Próxima →
                </button>
              </div>
              {key === "users" && (
                <>
                  <AccessPanel organization={org} />
                  <JsonCommand
                    title="Conceder ou revogar membership"
                    initial={{ user_id: "", status: "active" }}
                    submit={(value) =>
                      api("/security/membership", org, "POST", value)
                    }
                  />
                  <JsonCommand
                    title="Atribuir papel e escopo"
                    initial={{
                      user_id: "",
                      role_id: "",
                      scope_type: "organization",
                      scope_id: null,
                    }}
                    submit={(value) =>
                      api("/security/role", org, "POST", value)
                    }
                  />
                </>
              )}
              {key === "contacts" && (
                <JsonCommand
                  title="Conferir titularidade do e-mail com documento"
                  initial={{
                    contact_id: "",
                    contact_identity_id: "",
                    influencer_id: "",
                    email: "",
                    proof_object_id: "",
                    reason: "",
                    ownership_confirmed: false,
                  }}
                  submit={({ contact_id, ...value }) =>
                    api(
                      `/contacts/${contact_id}/email/verify`,
                      org,
                      "POST",
                      value,
                    )
                  }
                />
              )}
              {key === "policies" && (
                <>
                  <JsonCommand
                    title="Fontes e regras de risco"
                    initial={{
                      allowedSourceDomains: [],
                      blockedTerms: [],
                      requiredPhrases: [],
                      requireSourceEvidence: true,
                      requireFactualReview: true,
                      maxEvidenceAgeHours: 168,
                      requiredApprovals: 1,
                    }}
                    submit={(value) =>
                      api("/settings/risk-policy", org, "POST", value)
                    }
                  />
                  <JsonCommand
                    title="Criar versão da política editorial"
                    initial={{
                      code: "editorial",
                      resource_type: "content",
                      conditions: {},
                      steps: ["human_review"],
                    }}
                    submit={(value) =>
                      api("/security/policy", org, "POST", value)
                    }
                  />
                </>
              )}
              {key === "agent-runs" && (
                <JsonCommand
                  title="Conciliar custo reservado com comprovante"
                  initial={{
                    id: "",
                    amount: "",
                    currency: "USD",
                    input_tokens: 0,
                    output_tokens: 0,
                    evidence_object_id: "",
                    reason: "",
                  }}
                  submit={({ id, ...data }) =>
                    api(`/agent-runs/${id}/reconcile-cost`, org, "POST", data)
                  }
                />
              )}
              {key === "agent-assignments" && (
                <>
                  <JsonCommand
                    title="Ativar ou desativar agente"
                    initial={{ id: "", enabled: true }}
                    submit={({ id, ...data }) =>
                      api(`/agent-assignments/${id}/enable`, org, "POST", data)
                    }
                  />
                  <JsonCommand
                    title="Gerar conteúdo com orçamento"
                    initial={{
                      agent_assignment_id: "",
                      task_type: "content.generate",
                      content_id: "",
                      input: "",
                    }}
                    submit={(data) =>
                      api("/agent-runs", org, "POST", data, crypto.randomUUID())
                    }
                  />
                </>
              )}
            </section>
          ) : (
            <Empty title="Escolha um módulo" />
          )}
          <div className="module-links">
            {[
              ["/contracts", "Contratos"],
              ["/disclosures", "Transparência"],
              ["/assets", "Mídias"],
              ["/contacts", "Contatos"],
              ["/consents", "Consentimentos"],
              ["/templates", "Templates"],
              ["/connectors", "Conectores"],
              ["/settings/roles", "Papéis"],
              ["/settings/policies", "Políticas"],
              ["/partners", "Parceiros"],
              ["/revenues", "Receitas"],
              ["/costs", "Custos"],
              ["/licenses", "Licenças"],
              ["/legal-parties", "Titulares"],
              ["/identity-consents", "Imagem e voz"],
              ["/model-configs", "Modelos de IA"],
              ["/agents/runs", "Execuções e custos IA"],
              ["/onboarding-tasks", "Tarefas de onboarding"],
              ["/account-tasks", "Tarefas de contas"],
            ].map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </div>
          <footer className="workspace-footer">
            <span>DIM · Digital Influencer Management</span>
            <Link href="/about">Sobre</Link>
            <Link href="/privacy">Privacidade</Link>
            <Link href="/terms">Termos</Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
