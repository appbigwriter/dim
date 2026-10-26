"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { compareVersionText } from "../../../packages/contracts/src/version-comparison";
import { ErrorBanner } from "../../../packages/ui/src/index";
import PrivateMedia from "./private-media";
export default function ContentComparison({
  organization,
  id,
}: {
  organization: string;
  id: string;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    api(`/contents/${id}/presentation`, organization)
      .then((result) => {
        if (active) {
          setData(result);
          setFrom((current) =>
            result.versions.some((v: any) => v.id === current)
              ? current
              : result.versions[1]?.id || "",
          );
          setTo((current) =>
            result.versions.some((v: any) => v.id === current)
              ? current
              : result.versions[0]?.id || "",
          );
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [organization, id, revision]);
  const previous = data?.versions.find((version: any) => version.id === from),
    current = data?.versions.find((version: any) => version.id === to);
  const diff =
    previous && current
      ? compareVersionText(previous.body_text || "", current.body_text || "")
      : null;
  const removed = (previous?.body.source_urls || []).filter(
      (url: string) => !current?.body.source_urls?.includes(url),
    ),
    added = (current?.body.source_urls || []).filter(
      (url: string) => !previous?.body.source_urls?.includes(url),
    );
  return (
    <section className="panel">
      <h3>Comparacao de conteudo e midias</h3>
      <button
        type="button"
        className="secondary"
        onClick={() => setRevision((value) => value + 1)}
      >
        Carregar versoes para comparar
      </button>
      {error && <ErrorBanner error={error} />}
      {data && (
        <>
          <p>
            Escolha duas das ultimas 30 versoes salvas. A comparacao nao altera
            o conteudo nem sua aprovacao.
          </p>
          <div className="form-grid">
            {[
              ["Anterior", from, setFrom],
              ["Atual", to, setTo],
            ].map(([label, value, setter]: any) => (
              <label key={label}>
                {label}
                <select
                  value={value}
                  onChange={(event) => setter(event.target.value)}
                >
                  <option value="">Selecione uma versao</option>
                  {data.versions.map((version: any) => (
                    <option key={version.id} value={version.id}>
                      v{version.version_number} · {version.language} ·{" "}
                      {version.format}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {diff ? (
            <>
              <p>
                {previous.payload_hash === current.payload_hash
                  ? "O payload possui o mesmo hash."
                  : "Os payloads possuem hashes diferentes."}{" "}
                Idioma: {previous.language} → {current.language} · Formato:{" "}
                {previous.format} → {current.format}.
              </p>
              <article>
                <h4>Alteracoes no texto</h4>
                {diff.changed ? (
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {diff.prefix}
                    {diff.removed && (
                      <del style={{ background: "#fee2e2", color: "#7f1d1d" }}>
                        {diff.removed}
                      </del>
                    )}
                    {diff.added && (
                      <ins style={{ background: "#dcfce7", color: "#14532d" }}>
                        {diff.added}
                      </ins>
                    )}
                    {diff.suffix}
                  </pre>
                ) : (
                  <p>
                    Texto identico; confira fontes, formato e midias abaixo.
                  </p>
                )}
                <small>
                  Texto removido aparece riscado; texto adicionado aparece
                  sublinhado.
                </small>
              </article>
              <article>
                <h4>Fontes</h4>
                {!removed.length && !added.length ? (
                  <p>Nenhuma fonte adicionada ou removida.</p>
                ) : (
                  <>
                    <p>Removidas: {removed.length}</p>
                    <ul>
                      {removed.map((url: string) => (
                        <li key={url}>
                          <del>{url}</del>
                        </li>
                      ))}
                    </ul>
                    <p>Adicionadas: {added.length}</p>
                    <ul>
                      {added.map((url: string) => (
                        <li key={url}>
                          <ins>{url}</ins>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </article>
              {!data.media_visible && (
                <p>A visualizacao de midias exige permissao de governanca.</p>
              )}
              <div className="form-grid">
                {[
                  ["Anterior", previous],
                  ["Atual", current],
                ].map(([label, version]: any) => (
                  <article key={label}>
                    <h4>
                      {label} · v{version.version_number}
                    </h4>
                    <p>
                      {(version.body.asset_ids || []).length} arquivo(s)
                      vinculado(s)
                    </p>
                    {(version.body.asset_ids || []).map((assetId: string) => {
                      const candidates = data.assets.filter(
                          (asset: any) => asset.storage_object_id === assetId,
                        ),
                        asset =
                          candidates.find(
                            (item: any) => item.preview_allowed,
                          ) || candidates[0];
                      return asset ? (
                        <PrivateMedia
                          key={assetId}
                          organization={organization}
                          asset={asset}
                          label={`${label} · ${asset.asset_type}`}
                        />
                      ) : (
                        <p key={assetId}>
                          Arquivo {assetId}: metadados nao disponiveis ou fora
                          do seu escopo; a visualizacao permanece bloqueada.
                        </p>
                      );
                    })}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p>
              Selecione duas versoes salvas para comparar. Nenhuma versao e
              criada automaticamente.
            </p>
          )}
        </>
      )}
    </section>
  );
}
