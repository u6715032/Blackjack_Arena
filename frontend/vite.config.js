import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const backendEnvPath = fileURLToPath(
    new URL("../backend/.env", import.meta.url),
  );
  // Vite configuration executes in Node. Select only PORT; no backend values enter client code.
  const backendPort = existsSync(backendEnvPath)
    ? dotenv.parse(readFileSync(backendEnvPath)).PORT
    : undefined;
  const target =
    environment.BACKEND_PROXY_TARGET ||
    `http://127.0.0.1:${backendPort || 5000}`;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target, changeOrigin: true },
        "/socket.io": { target, ws: true, changeOrigin: true },
      },
    },
  };
});
