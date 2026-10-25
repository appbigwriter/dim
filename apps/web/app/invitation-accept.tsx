"use client";
import { useState } from "react";
import { api, authClient } from "./client";
export default function AcceptInvitation({ id }: { id: string }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [password, setPassword] = useState("");
  return (
    <main className="login-page">
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const { data } = await authClient().auth.getSession();
            if (!data.session)
              throw new Error(
                "Abra o link recebido por e-mail para confirmar sua identidade.",
              );
            const result = await authClient().auth.updateUser({ password });
            if (result.error) throw result.error;
            const accepted = await api(
              `/invitations/${id}/accept`,
              "",
              "POST",
              {},
            );
            localStorage.setItem("dim.organization", accepted.organization_id);
            location.assign("/dashboard");
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Aceitar convite</h1>
        <p>
          Confirme o acesso à organização usando a sessão do link recebido por
          e-mail.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <label>
          Defina sua senha
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={busy}>Aceitar e entrar</button>
      </form>
    </main>
  );
}
