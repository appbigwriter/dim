"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import { ErrorBanner } from "../../../packages/ui/src/index";
export default function PrivateMedia({
  organization,
  asset,
  label,
}: {
  organization: string;
  asset: any;
  label: string;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [expires, setExpires] = useState(0),
    [expired, setExpired] = useState(false);
  const requestSequence = useRef(0);
  useEffect(() => {
    requestSequence.current++;
    setUrl("");
    setError("");
    setExpired(false);
    setExpires(0);
    return () => {
      requestSequence.current++;
    };
  }, [organization, asset?.storage_object_id]);
  useEffect(() => {
    if (!expires) return;
    const timer = setTimeout(
      () => {
        setUrl("");
        setExpired(true);
      },
      Math.max(0, expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expires]);
  async function open() {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError("");
    setExpired(false);
    try {
      if (
        !asset.preview_allowed ||
        (asset.valid_until &&
          new Date(asset.valid_until).getTime() <= Date.now())
      )
        throw new Error(
          "Licenca vencida ou visualizacao bloqueada; recarregue os metadados.",
        );
      if (
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "video/mp4",
          "application/pdf",
        ].includes(asset.mime_type)
      )
        throw new Error("Formato sem pre-visualizacao habilitada.");
      const result = await api(
        `/storage/${asset.storage_object_id}/download?preview=true`,
        organization,
      );
      if (sequence !== requestSequence.current) return;
      if (
        asset.valid_until &&
        new Date(asset.valid_until).getTime() <= Date.now()
      )
        throw new Error(
          "A licenca expirou durante a autorizacao; recarregue os metadados.",
        );
      const link = new URL(result.url);
      if (
        link.username ||
        link.password ||
        (link.protocol !== "https:" &&
          !(
            link.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(link.hostname)
          ))
      )
        throw new Error("URL privada de visualizacao invalida");
      setUrl(link.href);
      setExpires(
        Math.min(
          Date.now() + Math.min(60, Number(result.expires_in) || 60) * 1000,
          asset.valid_until ? new Date(asset.valid_until).getTime() : Infinity,
        ),
      );
    } catch (error) {
      if (sequence === requestSequence.current)
        setError((error as Error).message);
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }
  const image = ["image/png", "image/jpeg", "image/webp"].includes(
    asset?.mime_type,
  );
  return (
    <article className="panel">
      <h4>{label}</h4>
      <p>
        {asset.asset_type} · {asset.mime_type || "Formato nao informado"} ·{" "}
        {Number(asset.byte_size || 0).toLocaleString("pt-BR")} bytes
      </p>
      <small>
        Arquivo {asset.storage_object_id} · SHA-256 {asset.sha256 || "ausente"}
      </small>
      {!asset.preview_allowed && (
        <p role="status">
          {asset.preview_blockers?.join("; ") || "Visualizacao nao autorizada"}
        </p>
      )}
      {asset.preview_allowed && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void open()}
        >
          {busy
            ? "Autorizando…"
            : url
              ? "Renovar acesso privado"
              : "Visualizar arquivo privado"}
        </button>
      )}
      {expired && (
        <p role="status">
          O acesso expirou. Solicite uma nova autorizacao para continuar.
        </p>
      )}
      {error && <ErrorBanner error={error} />}
      {url &&
        (image ? (
          <img
            src={url}
            alt={`${label}: ${asset.asset_type}`}
            referrerPolicy="no-referrer"
            onError={() => {
              setUrl("");
              setError(
                "Arquivo indisponivel ou acesso expirado. Solicite novo acesso.",
              );
            }}
            style={{ maxWidth: "100%", maxHeight: 440, objectFit: "contain" }}
          />
        ) : asset.mime_type === "video/mp4" ? (
          <video
            src={url}
            controls
            preload="metadata"
            onError={() => {
              setUrl("");
              setError("Video indisponivel ou acesso expirado.");
            }}
            style={{ width: "100%", maxHeight: 440 }}
          />
        ) : (
          <a href={url} target="_blank" rel="noopener noreferrer">
            Abrir documento privado (acesso de 60 segundos)
          </a>
        ))}
    </article>
  );
}
