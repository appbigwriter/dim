import { spawn } from "node:child_process";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const processes = [
  spawn(npm, ["run", "dev:api"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
  spawn(npm, ["run", "dev:web"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
];
const stop = () => {
  for (const p of processes) p.kill();
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const p of processes)
  p.on("exit", (code) => {
    if (code) stop();
  });
