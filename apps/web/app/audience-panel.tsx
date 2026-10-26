"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { ErrorBanner, StatusChip } from "../../../packages/ui/src/index";
import AudienceActionsPanel from "./audience-actions-panel";
export default function AudiencePanel({
  organization,
  id,
}: {
  organization: string;
  id: string;
}) {
  const [data, setData] = useState<any>(),
    [tenant, setTenant] = useState(""),
    [project, setProject] = useState(""),
    [persona, setPersona] = useState(""),
    [executor, setExecutor] = useState(""),
    [executionEnabled, setExecutionEnabled] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let valid = true;
    setData(undefined);
    api(`/influencers/${id}/audience/context`, organization)
      .then((result) => {
        if (valid) {
          setData(result);
          setExecutor(result.binding?.executor_user_id || "");
          setExecutionEnabled(result.binding?.execution_enabled || false);
        }
      })
      .catch((e) => {
        if (valid) setError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [organization, id, refresh]);
  async function run(path: string, body: any) {
    setBusy(true);
    try {
      await api(
        `/influencers/${id}/audience/${path}`,
        organization,
        "POST",
        body,
      );
      setError("");
      setRefresh((v) => v + 1);
    } catch (error) {
      setError((error as Error).message);
      setRefresh((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }
  const context = data?.current?.context;
  return (
    <section className="panel">
      <h3>Audience Builder · persona, autoridade e blog</h3>
      <p>
        A persona e a trajetória são geridas no Audience Builder. O DIM executa
        ações aprovadas nos canais e mantém sua própria conferência de direitos
        e publicação.
      </p>
      {error && <ErrorBanner error={error} />}
      <p>
        Origem:{" "}
        {data?.managed_by === "legacy_local"
          ? "Persona local legada; migração ao Audience pendente"
          : "Audience Builder"}
      </p>
      {data?.binding ? (
        <>
          <p>
            Projeto: {data.binding.project_id} · Persona:{" "}
            {data.binding.persona_id} ·{" "}
            <StatusChip status={data.binding.status} />
          </p>
          <button disabled={busy} onClick={() => void run("sync", {})}>
            {busy ? "Verificando…" : "Sincronizar contexto aprovado"}
          </button>
          {data.binding.last_verified_at && (
            <small>
              Última confirmação:{" "}
              {new Date(data.binding.last_verified_at).toLocaleString("pt-BR")}
            </small>
          )}
          {data.blockers.map((b: string) => (
            <p key={b} className="error">
              {b}
            </p>
          ))}
          <AudienceActionsPanel organization={organization} id={id} />
          <details>
            <summary>Execução contínua do plano aprovado</summary>
            <p>
              Um membro com papel audience_executor pode sincronizar o contexto,
              preparar ações e agendar versões revisadas. A aprovação editorial
              continua com outra pessoa. A configuração exige administração com
              MFA.
            </p>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void run("executor", {
                  enabled: executionEnabled,
                  ...(executionEnabled ? { executor_user_id: executor } : {}),
                });
              }}
            >
              <label>
                <input
                  type="checkbox"
                  checked={executionEnabled}
                  onChange={(e) => setExecutionEnabled(e.target.checked)}
                />
                Ativar processamento contínuo
              </label>
              <label>
                Identificador do membro executor
                <input
                  value={executor}
                  required={executionEnabled}
                  onChange={(e) => setExecutor(e.target.value)}
                  placeholder="UUID do membro com papel audience_executor"
                />
              </label>
              <button disabled={busy}>Salvar execução contínua</button>
            </form>
            {data.binding.last_execution_error && (
              <p className="error">
                Execução aguardando correção:{" "}
                {data.binding.last_execution_error}
              </p>
            )}
          </details>
        </>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void run("bind", {
              tenant_id: tenant,
              project_id: project,
              persona_id: persona,
            });
          }}
        >
          <p>
            Vincule o projeto aprovado. Esta ação exige administração com MFA;
            não cria outra persona.
          </p>
          <label>
            Tenant no Audience
            <input
              required
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
            />
          </label>
          <label>
            Projeto no Audience
            <input
              required
              value={project}
              onChange={(e) => setProject(e.target.value)}
            />
          </label>
          <label>
            Persona no Audience
            <input
              required
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
            />
          </label>
          <button disabled={busy}>Vincular Audience Builder</button>
        </form>
      )}
      {context && (
        <>
          <h4>
            Persona aprovada · versão {context.personaPackage.personaVersion}
          </h4>
          <p>{context.personaPackage.snapshot.characterBible.name}</p>
          <p>{context.personaPackage.snapshot.characterBible.bio}</p>
          <small>{context.personaPackage.contentHash}</small>
          <h4>Trajetória de autoridade</h4>
          {context.authority.objectives.map((objective: string) => (
            <p key={objective}>{objective}</p>
          ))}
          {context.authority.milestones.map((milestone: any) => (
            <p key={milestone.id}>
              {milestone.title} · <StatusChip status={milestone.status} />
            </p>
          ))}
          <h4>Blogs vinculados</h4>
          {context.blogs.map((blog: any) => (
            <p key={blog.id}>
              {blog.url ? (
                <a href={blog.url} target="_blank" rel="noopener noreferrer">
                  {blog.name} ↗
                </a>
              ) : (
                blog.name
              )}{" "}
              · <StatusChip status={blog.status} /> ·{" "}
              {blog.readbackVerified
                ? "Estado confirmado na origem"
                : "Confirmação técnica pendente"}
            </p>
          ))}
          <p className="muted">
            Alterações de persona, estratégia e gestão editorial do blog são
            feitas no Audience Builder. Importar contexto não publica conteúdo
            nem cria contas.
          </p>
        </>
      )}
    </section>
  );
}
