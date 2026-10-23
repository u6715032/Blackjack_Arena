import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

// Resolve relative to this file so `npm run dev` also works from the repository root.
dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});

export function readConfig() {
  for (const name of [
    "MONGODB_URI",
    "JWT_SECRET",
    "CLIENT_ORIGIN",
    "AI_SERVICE_URL",
  ]) {
    if (!process.env[name])
      throw new Error(`Missing ${name}. See backend/.env.example.`);
  }
  if (process.env.JWT_SECRET.length < 32)
    throw new Error("JWT_SECRET must have at least 32 characters.");
  const clientOrigin = new URL(process.env.CLIENT_ORIGIN).origin;
  const aiServiceUrl = new URL(process.env.AI_SERVICE_URL)
    .toString()
    .replace(/\/$/, "");
  const port = Number(process.env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a valid TCP port.");
  return {
    mongoUri: process.env.MONGODB_URI,
    jwtSecret: process.env.JWT_SECRET,
    port,
    clientOrigin,
    aiServiceUrl,
    secureCookie: process.env.COOKIE_SECURE === "true",
  };
}
