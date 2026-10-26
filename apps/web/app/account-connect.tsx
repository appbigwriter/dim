"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import { ErrorBanner } from "../../../packages/ui/src/index";
export default function AccountConnect({
  organization,
  accountId,
  provider,
  onConnected,
}: {
  organization: string;
  accountId: string;
  provider: string;
  onConnected?: () => void;
}) {
  const [operation, setOperation] = useState(""),
    [authorization, setAuthorization] = useState(""),
    [choices, setChoices] = useState<
      { id: string; label: string; channel: string }[]
    >([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setOperation("");
    setAuthorization("");
    setChoices([]);
    setSelected("");
    setError("");
    setMessage("");
  }, [organization, accountId]);
  if (!["x", "facebook", "instagram", "youtube"].includes(provider))
    return null;
  async function run(action: "start" | "choices" | "select") {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const base = `/accounts/${accountId}/connect`;
      const result = await api(
        action === "start" ? `${base}/start` : `${base}/${operation}/${action}`,
        organization,
        action === "choices" ? "GET" : "POST",
        action === "select"
          ? { external_id: selected }
          : action === "start"
            ? {}
            : undefined,
      );
      if (current !== generation.current) return;
      if (action === "start") {
        const url = new URL(result.authorization_url);
        if (
          url.protocol !== "https:" ||
          !["x.com", "accounts.google.com", "www.facebook.com"].includes(
            url.hostname,
          )
        )
          throw new Error("URL OAuth não autorizada");
        setOperation(result.operation_id);
        setAuthorization(url.href);
        setChoices([]);
        setMessage(
          "Abra a autorização do provedor. Ao concluir, volte a esta tela para confirmar a conta.",
        );
      } else if (action === "choices") {
        setChoices(result.choices);
        setSelected(result.choices[0]?.id || "");
      } else {
        setAuthorization("");
        setChoices([]);
        setOperation("");
        setMessage(
          "Conta conectada. Execute o teste de saúde para confirmar as capacidades autorizadas.",
        );
        onConnected?.();
      }
    } catch (failure) {
      if (current === generation.current) setError((failure as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Conectar conta autorizada">
      <h4>Autorizar {provider}</h4>
      <p>
        A autorização exige administração com MFA e confirma a titularidade no
        provedor. Credenciais ficam no cofre.
      </p>
      {error && <ErrorBanner error={error} />}
      {message && <p role="status">{message}</p>}
      <button disabled={busy} onClick={() => void run("start")}>
        Iniciar autorização
      </button>
      {authorization && (
        <p>
          <a href={authorization} target="_blank" rel="noopener noreferrer">
            Abrir autorização oficial ↗
          </a>
        </p>
      )}
      {operation && (
        <button disabled={busy} onClick={() => void run("choices")}>
          Já autorizei: carregar contas disponíveis
        </button>
      )}
      {choices.length > 0 && (
        <>
          <label>
            Conta autorizada
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label} · {choice.id}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !selected}
            onClick={() => void run("select")}
          >
            Confirmar vínculo desta conta
          </button>
        </>
      )}
    </section>
  );
}
