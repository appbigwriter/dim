"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { ErrorBanner, StatusChip } from "../../../packages/ui/src/index";
import MediaComparison from "./media-comparison";
const labels: Record<string, string> = {
  bio: "Biografia",
  centralPromise: "Promessa central",
  values: "Valores",
  tensions: "Tensoes",
  physicalDescription: "Descricao fisica",
  continuityAnchors: "Referencias de continuidade",
  styleTokens: "Estilo visual",
  voice: "Voz editorial",
  vocabulary: "Vocabulario",
  audience: "Publico",
  painPoints: "Necessidades",
  desires: "Desejos",
  editorialPillars: "Pilares editoriais",
  guardrails: "Limites",
  prohibitedTopics: "Temas proibidos",
};
function Values({ value }: { value: any }) {
  if (value == null || value === "") return <span>Nao informado</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((item, index) => (
          <li key={index}>
            <Values value={item} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{labels[key] || key}</dt>
            <dd>
              <Values value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}
export default function IdentityProfile({
  organization,
  id,
  onSaved,
}: {
  organization: string;
  id: string;
  onSaved: () => void;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    api(`/influencers/${id}/presentation`, organization)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [organization, id, revision]);
  async function command(path: string, body: any, method = "POST") {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await api(path, organization, method, body);
      setInfo("Alteracao registrada.");
      setRevision((value) => value + 1);
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="panel">
        <h3>Perfil da identidade</h3>
        {error ? (
          <ErrorBanner error={error} />
        ) : (
          <p>Carregando perfil autorizado…</p>
        )}
      </section>
    );
  const identity = data.identity,
    managed = identity.persona_source === "audience_builder",
    physical = data.audience_snapshot?.physicalIdentityBible,
    visual = data.audience_snapshot?.visualConsistencyProfile,
    character = data.audience_snapshot?.characterBible;
  return (
    <section className="panel">
      <h3>
        {identity.type === "human"
          ? "Pessoa e representacao"
          : identity.type === "hybrid"
            ? "Pessoa e identidade sintetica"
            : "Personagem e consistencia visual"}
      </h3>
      {error && <ErrorBanner error={error} />}{" "}
      {info && <p role="status">{info}</p>}
      <dl>
        <dt>Tipo</dt>
        <dd>
          {identity.type === "human"
            ? "Humano"
            : identity.type === "hybrid"
              ? "Hibrido"
              : "Virtual"}
        </dd>
        <dt>Idioma</dt>
        <dd>{identity.primary_language}</dd>
        <dt>Fuso de execucao</dt>
        <dd>{identity.timezone}</dd>
        <dt>Nicho</dt>
        <dd>{identity.niche || "Nao informado"}</dd>
        <dt>Origem da persona</dt>
        <dd>{managed ? "Audience Builder" : "Cadastro local legado"}</dd>
      </dl>
      {managed && (
        <p>
          A persona, o publico e o posicionamento sao geridos no Audience
          Builder. Estes dados aparecem somente para consulta no DIM.
        </p>
      )}
      {!data.governance_visible && (
        <p>
          Seu perfil permite consultar a identidade. Documentos, persona e
          midias exigem permissao de governanca.
        </p>
      )}
      {data.governance_visible && (
        <>
          <article>
            <h4>Biografia e proposta</h4>
            <p>
              {data.persona?.public_bio ||
                data.profile?.biography_short ||
                "Biografia ainda nao sincronizada."}
            </p>
            {data.profile?.biography_long && (
              <p>{data.profile.biography_long}</p>
            )}
            <p>
              {character?.centralPromise || data.profile?.value_proposition}
            </p>
          </article>
          {identity.type !== "virtual" && (
            <article>
              <h4>Titularidade e autorizacoes da pessoa</h4>
              {!data.contracts.length && <p>Nenhum contrato vinculado.</p>}
              {data.contracts.map((contract: any) => (
                <p key={contract.id}>
                  {contract.owner_name || "Titular nao informado"} ·{" "}
                  {contract.contract_type} v{contract.version} ·{" "}
                  <StatusChip status={contract.status} /> · validade{" "}
                  {contract.ends_at
                    ? new Date(contract.ends_at).toLocaleDateString("pt-BR")
                    : "nao informada"}
                </p>
              ))}
              {data.consents.map((consent: any) => (
                <p key={consent.id}>
                  {consent.subject_name} · {consent.use_type} ·{" "}
                  {consent.revoked_at
                    ? "Revogado"
                    : consent.expires_at &&
                        new Date(consent.expires_at) < new Date()
                      ? "Expirado"
                      : "Concessao registrada"}
                </p>
              ))}
              <small>
                As datas e provas completas permanecem na governanca; esta
                leitura nao substitui a conferencia de direitos.
              </small>
            </article>
          )}
          {identity.type !== "human" && (
            <article>
              <h4>Personagem, aparencia e disclosure</h4>
              <p>
                {physical?.physicalDescription ||
                  "Descricao fisica nao sincronizada."}
              </p>
              {physical?.continuityAnchors && (
                <Values value={physical.continuityAnchors} />
              )}
              <p>
                {visual?.aiDisclosure ||
                  "Disclosure precisa estar cadastrado e aprovado por canal."}
              </p>
              {visual?.styleTokens && <Values value={visual.styleTokens} />}
            </article>
          )}
          <details>
            <summary>Publico, voz e limites</summary>
            <Values
              value={
                data.audience_snapshot?.editorialProfile ||
                data.profile?.audience ||
                data.persona?.knowledge
              }
            />
            <h4>Limites registrados</h4>
            <Values value={data.persona?.boundaries} />
          </details>
          {!managed && (
            <details>
              <summary>Editar biografia do cadastro legado</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void command(`/influencers/${id}/profile`, {
                    row_version: identity.row_version,
                    biography_short: form.get("biography_short"),
                    biography_long:
                      String(form.get("biography_long") || "") || undefined,
                    value_proposition: form.get("value_proposition"),
                    audience: data.profile?.audience || {},
                    positioning: data.profile?.positioning || {},
                    appearance_settings:
                      data.profile?.appearance_settings || {},
                  });
                }}
              >
                <label>
                  Biografia curta
                  <textarea
                    name="biography_short"
                    required
                    defaultValue={
                      data.profile?.biography_short ||
                      data.persona?.public_bio ||
                      ""
                    }
                  />
                </label>
                <label>
                  Biografia longa
                  <textarea
                    name="biography_long"
                    defaultValue={data.profile?.biography_long || ""}
                  />
                </label>
                <label>
                  Proposta de valor
                  <textarea
                    name="value_proposition"
                    required
                    defaultValue={data.profile?.value_proposition || ""}
                  />
                </label>
                <button disabled={busy}>
                  Salvar perfil com controle de versao
                </button>
              </form>
            </details>
          )}
          <MediaComparison
            key={id}
            organization={organization}
            assets={data.assets}
          />
        </>
      )}
      <details>
        <summary>Dados operacionais do DIM</summary>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void command(
              `/influencers/${id}`,
              {
                row_version: identity.row_version,
                internal_name: form.get("internal_name"),
                slug: form.get("slug"),
                timezone: form.get("timezone"),
                owner_user_id: form.get("owner_user_id"),
                ...(!managed
                  ? {
                      public_name: form.get("public_name"),
                      primary_language: form.get("primary_language"),
                      ...(form.get("niche")
                        ? { niche: form.get("niche") }
                        : {}),
                    }
                  : {}),
              },
              "PATCH",
            );
          }}
        >
          <label>
            Nome interno
            <input
              name="internal_name"
              required
              defaultValue={identity.internal_name}
            />
          </label>
          <label>
            Identificador de URL
            <input
              name="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={80}
              defaultValue={identity.slug}
            />
          </label>
          <label>
            Fuso horario
            <input name="timezone" required defaultValue={identity.timezone} />
          </label>
          <label>
            Responsavel operacional
            <select
              name="owner_user_id"
              defaultValue={identity.owner_user_id}
              required
            >
              {data.team.map((member: any) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name || member.user_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {!managed && (
            <>
              <label>
                Nome publico
                <input
                  name="public_name"
                  required
                  defaultValue={identity.public_name}
                />
              </label>
              <label>
                Nicho
                <input name="niche" defaultValue={identity.niche || ""} />
              </label>
              <label>
                Idioma
                <select
                  name="primary_language"
                  defaultValue={identity.primary_language}
                >
                  <option value="pt-BR">Portugues</option>
                  <option value="en">Ingles</option>
                  <option value="es">Espanhol</option>
                </select>
              </label>
            </>
          )}
          <button disabled={busy}>Salvar dados operacionais</button>
        </form>
      </details>
      <details>
        <summary>Estado e responsabilidades</summary>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void command(`/influencers/${id}/transition`, {
              status: form.get("status"),
              reason: form.get("reason"),
              row_version: identity.row_version,
            });
          }}
        >
          <label>
            Novo estado
            <select name="status" defaultValue={identity.status}>
              {[
                "draft",
                "under_review",
                "changes_required",
                "approved",
                "provisioning",
                "ready",
                "active",
                "paused",
                "restricted",
                "offboarding",
                "archived",
              ].map((status) => (
                <option value={status} key={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Motivo
            <textarea required name="reason" />
          </label>
          <button disabled={busy}>Solicitar transicao validada</button>
        </form>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void command(`/influencers/${id}/assignments`, {
              user_id: form.get("user_id"),
              responsibility: form.get("responsibility"),
            });
          }}
        >
          <label>
            Colaborador
            <select name="user_id" required>
              <option value="">Selecione</option>
              {data.team.map((member: any) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name || member.user_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Responsabilidade
            <select name="responsibility">
              <option value="editor">Editor</option>
              <option value="manager">Gestor</option>
            </select>
          </label>
          <button disabled={busy}>Registrar responsabilidade</button>
        </form>
      </details>
    </section>
  );
}
