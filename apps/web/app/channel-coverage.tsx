"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { ErrorBanner, StatusChip } from "../../../packages/ui/src/index";
export default function ChannelCoverage({
  organization,
  id,
}: {
  organization: string;
  id: string;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState("");
  useEffect(() => {
    let valid = true;
    api(`/influencers/${id}/channels`, organization)
      .then((r) => {
        if (valid) setData(r);
      })
      .catch((e) => {
        if (valid) setError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [organization, id]);
  return (
    <section className="panel">
      <h3>Canais obrigatórios desta identidade</h3>
      <p role="status">
        <strong>Prontidão para a operação completa: incompleta</strong>
      </p>
      {error && <ErrorBanner error={error} />}
      <p>
        O cadastro de uma conta é independente da implementação do conector e da
        homologação com o provedor.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Canal</th>
              <th>Implementação no sistema</th>
              <th>Contas desta identidade</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((channel: any) => (
              <tr key={channel.code}>
                <td>{channel.name}</td>
                <td>
                  {channel.implementation === "catalog_only"
                    ? "Somente catálogo; integração pendente"
                    : "Implementação local parcial"}
                  <small>{channel.capabilities.join(" · ")}</small>
                  {channel.blockers.map((blocker: string) => (
                    <p key={blocker}>
                      {
                        (
                          {
                            adapter_not_implemented:
                              "Conector ainda não implementado",
                            account_not_linked: "Conta ainda não vinculada",
                            account_not_connected: "Conta ainda não conectada",
                          } as any
                        )[blocker]
                      }
                    </p>
                  ))}
                </td>
                <td>
                  {channel.code === "crm" ? (
                    <a href="/contacts">Abrir CRM interno</a>
                  ) : channel.accounts.length ? (
                    channel.accounts.map((a: any) => (
                      <p key={a.id}>
                        {a.handle || a.id.slice(0, 8)} ·{" "}
                        <StatusChip status={a.integration_status} />
                      </p>
                    ))
                  ) : (
                    "Sem conta visível vinculada"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Homologação externa ainda não verificada. Cada influenciador precisa de
        contas e autorizações próprias.
      </p>
    </section>
  );
}
