"use client";
import { useState, useEffect } from "react";
import { api } from "./client";
export const labels: Record<string, string> = {
  public_name: "Nome público",
  internal_name: "Nome interno",
  slug: "Identificador",
  type: "Tipo de identidade",
  primary_language: "Idioma",
  timezone: "Fuso horário",
  niche: "Nicho",
  owner_user_id: "Responsável (ID do usuário)",
  influencer_id: "Influenciador (ID)",
  platform_id: "Plataforma (ID)",
  handle: "Handle",
  public_url: "URL pública",
  owner_reference: "Titularidade",
  recovery_owner_id: "Responsável por recuperação (ID)",
  account_type: "Tipo de conta",
  external_id: "ID externo",
  title: "Título",
  objective: "Objetivo",
  content_type: "Formato",
  name: "Nome",
  display_name: "Nome de exibição",
  locale: "Idioma",
  currency: "Moeda",
  amount: "Valor",
  budget: "Orçamento",
  starts_at: "Início",
  ends_at: "Fim",
  due_at: "Prazo",
  source: "Origem",
  body_text: "Conteúdo",
  language: "Idioma",
  format: "Formato",
  source_urls: "Fontes (JSON)",
  asset_ids: "Mídias (IDs em JSON)",
  body: "Atributos (JSON)",
  reason: "Justificativa",
  status: "Estado",
  contract_type: "Tipo de contrato",
  storage_object_id: "Documento privado (ID)",
  owner_party_id: "Titular jurídico (ID)",
  version: "Versão",
  terms: "Condições (JSON)",
  party_type: "Pessoa ou empresa",
  country_code: "País (2 letras)",
  scope: "Escopo (JSON)",
  use_type: "Uso autorizado",
  evidence_object_id: "Evidência privada (ID)",
  granted_at: "Concedido em",
  expires_at: "Expira em",
  purpose: "Finalidade",
  channel: "Canal",
  lawful_basis: "Fundamento",
  evidence_ref: "Referência da evidência",
  subject_party_id: "Pessoa titular (ID)",
  license_id: "Licença (ID)",
  asset_type: "Tipo de mídia",
  provenance: "Proveniência (JSON)",
  license_type: "Tipo de licença",
  holder_party_id: "Titular da licença (ID)",
  valid_until: "Válida até",
  disclosure_type: "Tipo de transparência",
  disclosure_text: "Texto público",
  policy_version: "Versão da política",
  enabled: "Habilitado",
  source_notes: "Fontes (JSON)",
  topic_id: "Pauta (ID)",
  contact_id: "Contato (ID)",
  social_account_id: "Conta (ID)",
  external_thread_id: "Conversa no provedor",
  provider: "Provedor",
  content: "Conteúdo (JSON)",
  approval_status: "Estado de aprovação",
  provider_template_id: "Template do provedor",
  category: "Categoria",
  partner_id: "Parceiro (ID)",
  campaign_id: "Campanha (ID)",
  content_id: "Conteúdo (ID)",
  occurred_at: "Ocorrido em",
  cost_type: "Tipo de custo",
  severity: "Severidade",
  assigned_to: "Responsável (ID)",
  session_id: "Sessão de onboarding (ID)",
  task_code: "Tarefa",
  task_key: "Tarefa",
  assignee_id: "Responsável (ID)",
  model_id: "Modelo",
  parameters: "Parâmetros (JSON)",
  cost_policy: "Limites de custo e tokens (JSON)",
  agent_id: "Agente (ID)",
  model_config_id: "Configuração de modelo (ID)",
  approval_policy_id: "Política editorial (ID)",
  settings: "Configuração (JSON)",
  public_bio: "Bio pública",
  tone: "Voz (JSON)",
  traits: "Características (JSON)",
  knowledge: "Fatos canônicos (JSON)",
  boundaries: "Limites (JSON)",
  decision: "Decisão",
  rationale: "Justificativa",
  content_version_id: "Versão exata (ID)",
  scheduled_at: "Agendar para (com fuso)",
};
export function ResourceForm({
  schema,
  organization,
  endpoint,
  onSaved,
  onCancel,
  initial = {},
}: {
  schema: any;
  organization: string;
  endpoint: string;
  onSaved: (v: any) => void;
  onCancel: () => void;
  initial?: any;
}) {
  const [values, setValues] = useState<any>(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [references, setReferences] = useState<Record<string, any[]>>({});
  useEffect(() => {
    let active = true;
    const sources: Record<string, string> = {
      influencer_id: "influencers",
      platform_id: "platforms",
      owner_party_id: "legal-parties",
      subject_party_id: "legal-parties",
      holder_party_id: "legal-parties",
      storage_object_id: "storage-objects",
      evidence_object_id: "storage-objects",
      license_id: "licenses",
      contact_id: "contacts",
      social_account_id: "accounts",
      partner_id: "partners",
      campaign_id: "campaigns",
      content_id: "contents",
      topic_id: "topics",
      model_config_id: "model-configs",
      approval_policy_id: "policies",
      session_id: "onboarding-sessions",
      agent_id: "agent-definitions",
    };
    const fields = Object.keys(schema.properties || {});
    for (const field of fields) {
      if (sources[field])
        void api(`/${sources[field]}?per_page=100`, organization)
          .then((result) => {
            if (active)
              setReferences((prev) => ({
                ...prev,
                [field]: result.data || [],
              }));
          })
          .catch(() => {});
    }
    if (
      fields.some((f) =>
        ["owner_user_id", "recovery_owner_id", "assignee_id"].includes(f),
      )
    )
      void api("/session", "")
        .then((result) => {
          if (active) {
            setValues((prev: any) => ({
              ...Object.fromEntries(
                fields
                  .filter((f) =>
                    [
                      "owner_user_id",
                      "recovery_owner_id",
                      "assignee_id",
                    ].includes(f),
                  )
                  .map((f) => [f, result.userId]),
              ),
              ...prev,
            }));
            for (const field of [
              "owner_user_id",
              "recovery_owner_id",
              "assignee_id",
            ])
              setReferences((prev) => ({
                ...prev,
                [field]: [
                  {
                    id: result.userId,
                    display_name: "Você (usuário autenticado)",
                  },
                ],
              }));
          }
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [organization, schema]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result: any = {};
      for (const [key, p] of Object.entries<any>(schema.properties || {})) {
        let value = values[key];
        if (value === "" || value === undefined) {
          if (p.default !== undefined) value = p.default;
          else continue;
        }
        if (p.type === "object" || p.type === "array")
          value = typeof value === "string" ? JSON.parse(value) : value;
        if (p.type === "number" || p.type === "integer") value = Number(value);
        if (
          p.format === "date-time" &&
          typeof value === "string" &&
          !/(Z|[+-]\d\d:\d\d)$/.test(value)
        )
          value = new Date(value).toISOString();
        result[key] = value;
      }
      onSaved(
        await api(endpoint, organization, "POST", result, crypto.randomUUID()),
      );
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="resource-form">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="form-grid">
        {Object.entries<any>(schema.properties || {}).map(([key, p]) => (
          <label
            key={key}
            className={p.type === "object" || p.type === "array" ? "wide" : ""}
          >
            {labels[key] || key}
            {schema.required?.includes(key) && " *"}
            {p.enum ? (
              <select
                required={schema.required?.includes(key)}
                value={values[key] ?? p.default ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
              >
                <option value="">Selecione</option>
                {p.enum.map((value: string) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            ) : references[key]?.length ? (
              <select
                required={schema.required?.includes(key)}
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
              >
                <option value="">Selecione um registro</option>
                {references[key].map((ref) => (
                  <option key={ref.id} value={ref.id}>
                    {ref.public_name ||
                      ref.name ||
                      ref.display_name ||
                      ref.title ||
                      ref.handle ||
                      ref.code ||
                      ref.object_path ||
                      ref.id}
                  </option>
                ))}
              </select>
            ) : p.type === "boolean" ? (
              <input
                type="checkbox"
                checked={values[key] ?? p.default ?? false}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.checked })
                }
              />
            ) : p.type === "object" || p.type === "array" ? (
              <textarea
                rows={3}
                required={schema.required?.includes(key)}
                placeholder={p.type === "array" ? "[]" : "{}"}
                value={
                  typeof values[key] === "object"
                    ? JSON.stringify(values[key], null, 2)
                    : (values[key] ??
                      (p.default !== undefined
                        ? JSON.stringify(p.default)
                        : ""))
                }
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
              />
            ) : (
              <input
                required={schema.required?.includes(key)}
                type={
                  p.format === "date-time"
                    ? "datetime-local"
                    : p.type === "number" || p.type === "integer"
                      ? "number"
                      : "text"
                }
                maxLength={p.maxLength}
                value={values[key] ?? p.default ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [key]: e.target.value })
                }
              />
            )}
          </label>
        ))}
      </div>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Voltar
        </button>
        <button disabled={busy} className="primary">
          {busy ? "Salvando…" : "Salvar registro"}
        </button>
      </div>
    </form>
  );
}
export function JsonCommand({
  title,
  initial,
  submit,
}: {
  title: string;
  initial: any;
  submit: (body: any) => Promise<any>;
}) {
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(JSON.stringify(initial, null, 2)),
    [result, setResult] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div>
      <button className="secondary" onClick={() => setOpen(!open)}>
        {title}
      </button>
      {open && (
        <form
          className="command"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const res = await submit(JSON.parse(value));
              setResult(JSON.stringify(res, null, 2));
            } catch (e) {
              setResult((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {title}
            <textarea
              rows={8}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <button disabled={busy}>Executar</button>
          {result && <pre role="status">{result}</pre>}
        </form>
      )}
    </div>
  );
}
export function UploadPanel({ organization }: { organization: string }) {
  const [influencers, setInfluencers] = useState<any[]>([]),
    [identity, setIdentity] = useState(""),
    [file, setFile] = useState<File>(),
    [error, setError] = useState(""),
    [result, setResult] = useState<any>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api("/influencers?per_page=100", organization)
      .then((r) => setInfluencers(r.data))
      .catch((e) => setError(e.message));
  }, [organization]);
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        setBusy(true);
        try {
          if (file.size > (file.type === "video/mp4" ? 100 : 5) * 1024 * 1024)
            throw new Error("Limite: MP4 até 100 MB; demais arquivos até 5 MB");
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          setResult(
            await api("/storage/upload", organization, "POST", {
              influencer_id: identity,
              mime_type: file.type,
              base64,
            }),
          );
          setError("");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Arquivo privado</h2>
      <p className="muted">
        PDF, PNG, JPEG ou WebP até 5 MB; MP4 até 100 MB · verificação de
        antivírus
      </p>
      {error && <div className="error">{error}</div>}
      <div className="form-grid">
        <label>
          Identidade
          <select
            required
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
          >
            <option value="">Selecione</option>
            {influencers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.public_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Arquivo
          <input
            required
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,video/mp4"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
        </label>
      </div>
      <button disabled={busy}>
        {busy ? "Verificando e enviando…" : "Enviar para armazenamento privado"}
      </button>
      {result && (
        <p role="status">
          Arquivo liberado: <code>{result.id}</code>
          <button
            type="button"
            className="text-button"
            onClick={async () => {
              try {
                const link = await api(
                  `/storage/${result.id}/download`,
                  organization,
                );
                window.open(link.url, "_blank", "noopener,noreferrer");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Abrir download temporário ↗
          </button>
        </p>
      )}
    </form>
  );
}
