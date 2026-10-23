import mongoose from "mongoose";
import { readConfig } from "./config.js";
import { connectDatabase, database } from "./services/database.js";
import { createApplication } from "./app.js";

try {
  const config = readConfig();
  await connectDatabase(config.mongoUri);
  console.log("MongoDB connected; required indexes ready.");
  const { server, io } = createApplication({ config, repository: database });
  server.listen(config.port, () =>
    console.log(`Blackjack Arena backend ready on port ${config.port}.`),
  );
  async function shutdown() {
    io.close();
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  console.error(
    error.message.startsWith("Missing ") ||
      /JWT_SECRET|PORT must/.test(error.message)
      ? error.message
      : "Startup failed. Check MongoDB credentials, network access, and configuration. Private connection details were omitted.",
  );
  await mongoose.disconnect();
  process.exitCode = 1;
}
