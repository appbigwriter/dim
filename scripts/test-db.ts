import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("❌ ERRO: DATABASE_URL não está configurada no ambiente.");
  process.exit(1);
}

try {
  const parsed = new URL(url);
  console.log(`🔍 Testando conexão com PostgreSQL:`);
  console.log(`   Host: ${parsed.hostname}`);
  console.log(`   Porta: ${parsed.port || "5432"}`);
  console.log(`   Banco: ${parsed.pathname.replace(/^\//, "")}`);
  console.log(`   Usuário: ${parsed.username}`);
  console.log(`   SSL na URL: ${parsed.searchParams.get("sslmode") || "não especificado"}`);
} catch (e) {
  console.error("⚠️ URL de conexão parece malformada (verifique caracteres especiais na senha):", (e as Error).message);
}

async function tryConnect(label: string, sslConfig: any) {
  console.log(`\n⏳ Tentando conexão (${label})...`);
  const pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 8000,
    ssl: sslConfig,
  });

  try {
    const client = await pool.connect();
    const res = await client.query("SELECT version(), current_database(), current_user");
    console.log(`✅ SUCESSO com ${label}!`);
    console.log(`   Banco conectado: ${res.rows[0].current_database}`);
    console.log(`   Usuário: ${res.rows[0].current_user}`);
    console.log(`   Versão: ${res.rows[0].version.split(",")[0]}`);
    client.release();
    await pool.end();
    return true;
  } catch (err: any) {
    console.error(`❌ Falha com ${label}: ${err.message}`);
    if (err.code) console.error(`   Código do erro Postgres: ${err.code}`);
    await pool.end().catch(() => {});
    return false;
  }
}

// 1. Testa com SSL permissivo (rejectUnauthorized: false)
let ok = await tryConnect("SSL Ativado (rejectUnauthorized: false)", { rejectUnauthorized: false });

// 2. Se falhar, testa sem SSL
if (!ok) {
  ok = await tryConnect("Sem SSL (desativado)", false);
}

if (ok) {
  console.log("\n🎉 Conexão com o banco de dados validada com sucesso!");
} else {
  console.error("\n🚨 Ambas as tentativas falharam. Verifique:");
  console.error("  1. Se a senha contém caracteres especiais (ex: @, #, :) que precisam de URL encoding (ex: @ vira %40)");
  console.error("  2. Se a porta (5432 direta vs 6543 pooler) está aberta no firewall");
  console.error("  3. Se o host do banco de dados é acessível a partir do container");
}
