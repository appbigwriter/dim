"use client";
import { useState } from "react";
import PrivateMedia from "./private-media";
export default function MediaComparison({
  organization,
  assets,
}: {
  organization: string;
  assets: any[];
}) {
  const [left, setLeft] = useState(""),
    [right, setRight] = useState("");
  const current = assets.find((asset) => asset.asset_id === right) || assets[0];
  const previous = assets.find((asset) => asset.asset_id === left) || assets[1];
  if (!assets.length)
    return (
      <p>
        Nenhuma midia vinculada a esta identidade. Arquivos precisam de licenca
        e verificacao antes da visualizacao.
      </p>
    );
  return (
    <section className="panel">
      <h3>Midias e comparacao visual</h3>
      <p>
        Compare dois arquivos vinculados. Datas e hashes identificam os
        arquivos; esta selecao nao altera a aprovacao nem cria uma versao.
      </p>
      <div className="form-grid">
        {[
          ["Arquivo anterior", left, setLeft, previous],
          ["Arquivo atual", right, setRight, current],
        ].map(([label, value, setter, asset]: any) => (
          <section key={label}>
            <label>
              {label}
              <select
                value={value || asset?.asset_id || ""}
                onChange={(event) => setter(event.target.value)}
              >
                <option value="">Selecione</option>
                {assets.map((item) => (
                  <option key={item.asset_id} value={item.asset_id}>
                    {item.asset_type} ·{" "}
                    {new Date(item.created_at).toLocaleString("pt-BR")} ·{" "}
                    {item.storage_object_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {asset && (
              <PrivateMedia
                key={asset.asset_id}
                organization={organization}
                asset={asset}
                label={label}
              />
            )}
          </section>
        ))}
      </div>
      {previous && current && (
        <p>
          {previous.sha256 === current.sha256
            ? "Os bytes dos dois arquivos tem o mesmo checksum."
            : "Os arquivos possuem checksums diferentes."}
        </p>
      )}
    </section>
  );
}
