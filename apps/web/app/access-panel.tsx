"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { ErrorBanner } from "../../../packages/ui/src/index";
export default function AccessPanel({
  organization,
}: {
  organization: string;
}) {
  const [roles, setRoles] = useState<any[]>([]),
    [sessions, setSessions] = useState<any[]>([]),
    [email, setEmail] = useState(""),
    [role, setRole] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [refresh, setRefresh] = useState(0),
    [key, setKey] = useState(""),
    [policy, setPolicy] = useState({
      sla_hours: 24,
      retention_days: 365,
      whatsapp_window_hours: 24,
    });
  useEffect(() => {
    let valid = true;
    Promise.all([
      api("/roles?per_page=100", organization),
      api("/security/sessions", organization),
      api("/settings/inbox", organization),
    ])
      .then(([r, s, p]) => {
        if (valid) {
          setPolicy(p);
          setRoles(r.data);
          setSessions(s.data);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      valid = false;
    };
  }, [organization, refresh]);
  return (
    <section className="panel">
      <h2>Política de atendimento</h2>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/settings/inbox", organization, "POST", policy);
            setStatus("Política de atendimento salva");
            setError("");
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      >
        {Object.entries({
          sla_hours: "SLA (horas)",
          retention_days: "Retenção para revisão (dias)",
          whatsapp_window_hours: "Janela WhatsApp (horas)",
        }).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              required
              type="number"
              min="1"
              max={
                key === "whatsapp_window_hours"
                  ? 24
                  : key === "sla_hours"
                    ? 720
                    : 3650
              }
              value={(policy as any)[key]}
              onChange={(e) =>
                setPolicy({ ...policy, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <button>Salvar política</button>
      </form>
      <h2>Convidar integrante</h2>
      {error && <ErrorBanner error={error} />}
      <p role="status">{status}</p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const id = key || crypto.randomUUID();
          setKey(id);
          try {
            const result = await api(
              "/security/invitations",
              organization,
              "POST",
              { email, role_id: role, expires_days: 7 },
              id,
            );
            setStatus(`Convite: ${result.status}`);
            if (result.status === "invited") {
              setEmail("");
              setKey("");
            }
            setError("");
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      >
        <label>
          E-mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setKey("");
            }}
          />
        </label>
        <label>
          Papel
          <select
            required
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setKey("");
            }}
          >
            <option value="">Selecione</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || r.code}
              </option>
            ))}
          </select>
        </label>
        <button>Enviar convite por e-mail</button>
      </form>
      <h2>Sessões na organização</h2>
      {sessions.map((s) => (
        <p key={s.id}>
          {s.user_id} · {new Date(s.created_at).toLocaleString("pt-BR")} ·{" "}
          {s.revoked ? (
            "Revogada"
          ) : (
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await api(
                    `/security/sessions/${s.id}/revoke`,
                    organization,
                    "POST",
                    {},
                  );
                  setRefresh((v) => v + 1);
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              Revogar acesso desta sessão
            </button>
          )}
        </p>
      ))}
    </section>
  );
}
