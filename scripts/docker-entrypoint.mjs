import { spawn } from "node:child_process";

const role = (
  process.env.SERVICE_ROLE ||
  process.env.SERVICE_NAME ||
  process.env.APP_TYPE ||
  "all"
).toLowerCase();

console.log(`[DIM Launcher] Inicializando container com perfil: ${role}`);

const children = [];

function runProcess(cmd, args, name, env = {}) {
  const proc = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  proc.on("exit", (code, signal) => {
    console.log(`[DIM Launcher] Processo ${name} finalizou (código: ${code}, sinal: ${signal})`);
    // Se o frontend web ou a api caírem no modo all, encerra para o Docker reiniciar
    if (role === "all" && (name === "web" || name === "api") && code !== 0 && code !== null) {
      console.error(`[DIM Launcher] Processo crítico ${name} encerrou com erro. Reiniciando container...`);
      shutdown();
      process.exit(code || 1);
    }
  });
  children.push(proc);
  return proc;
}

function shutdown() {
  for (const proc of children) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // Ignora falhas se já estiver morto
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[DIM Launcher] Sinal ${signal} recebido. Finalizando serviços...`);
    shutdown();
    setTimeout(() => process.exit(0), 5000);
  });
}

if (role === "api") {
  runProcess("node", ["--import", "tsx", "apps/api/src/main.ts"], "api", {
    HOST: "0.0.0.0",
    PORT: process.env.PORT || "3001",
  });
} else if (role === "worker") {
  runProcess("node", ["--import", "tsx", "apps/worker/src/main.ts"], "worker");
} else if (role === "web") {
  runProcess("node", ["apps/web/server.js"], "web", {
    PORT: process.env.PORT || "3000",
    HOSTNAME: "0.0.0.0",
  });
} else {
  // Padrão: modo combinado (all) - inicia API na porta 3001 e Web na porta 3000
  console.log("[DIM Launcher] Modo combinado: iniciando API (porta 3001) e Frontend Web (porta 3000)...");
  runProcess("node", ["--import", "tsx", "apps/api/src/main.ts"], "api", {
    HOST: "0.0.0.0",
    PORT: "3001",
  });

  const hasWorkerEnv = Boolean(
    process.env.DATABASE_URL &&
    process.env.REDIS_URL &&
    process.env.VAULT_ADDR &&
    process.env.VAULT_TOKEN
  );
  if (hasWorkerEnv) {
    console.log("[DIM Launcher] Configurações de worker detectadas. Iniciando worker BullMQ...");
    runProcess("node", ["--import", "tsx", "apps/worker/src/main.ts"], "worker");
  } else {
    console.log("[DIM Launcher] Worker assíncrono em espera (para habilitar, configure REDIS_URL, VAULT_ADDR e VAULT_TOKEN).");
  }

  runProcess("node", ["apps/web/server.js"], "web", {
    PORT: "3000",
    HOSTNAME: "0.0.0.0",
    API_INTERNAL_URL: process.env.API_INTERNAL_URL || "http://127.0.0.1:3001",
  });
}
