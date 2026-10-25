import { spawn } from "node:child_process";

const role = (
  process.env.SERVICE_ROLE ||
  process.env.SERVICE_NAME ||
  process.env.APP_TYPE ||
  "web"
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
    if (role === "all" && code !== 0 && code !== null) {
      console.error(`[DIM Launcher] Encerrando processos restantes devido a falha em ${name}`);
      shutdown();
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
  runProcess("node", ["--import", "tsx", "apps/api/src/main.ts"], "api");
} else if (role === "worker") {
  runProcess("node", ["--import", "tsx", "apps/worker/src/main.ts"], "worker");
} else if (role === "all") {
  console.log("[DIM Launcher] Modo combinado: iniciando API (3001), Worker e Web (3000)...");
  runProcess("node", ["--import", "tsx", "apps/api/src/main.ts"], "api", {
    HOST: "0.0.0.0",
    PORT: "3001",
  });
  runProcess("node", ["--import", "tsx", "apps/worker/src/main.ts"], "worker");
  runProcess("node", ["apps/web/server.js"], "web", {
    PORT: "3000",
    HOSTNAME: "0.0.0.0",
  });
} else {
  // Default: web
  runProcess("node", ["apps/web/server.js"], "web", {
    PORT: "3000",
    HOSTNAME: "0.0.0.0",
  });
}
