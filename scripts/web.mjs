import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { spawn } from "node:child_process";
loadEnvConfig(process.cwd(), process.argv[2] === "dev");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", process.argv[2], "apps/web", ...process.argv.slice(3)], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code ?? 1; });
