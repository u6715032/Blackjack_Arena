import mongoose from "mongoose";
import { readConfig } from "./config.js";
import { connectDatabase, database } from "./services/database.js";
import { createApplication } from "./app.js";
import { refundPendingBets } from "./services/betting.js";
import { cleanupMessages } from "./services/social.js";
import { markOverdue } from "./services/finance.js";

try {
  const config = readConfig();
  await connectDatabase(config.mongoUri);
  await refundPendingBets();
  await cleanupMessages();
  await markOverdue();
  console.log("MongoDB connected; required indexes ready.");
  const { server, io } = createApplication({ config, repository: database });
  let cleaningChat = false;
  const chatCleanupTimer = setInterval(async () => {
    if (cleaningChat) return;
    cleaningChat = true;
    try {
      const [removed, overdue] = await Promise.all([
        cleanupMessages(),
        markOverdue(),
      ]);
      if (removed || overdue) io.emit("social:update");
    } catch {
      console.error("Chat cleanup failed; it will be retried.");
    } finally {
      cleaningChat = false;
    }
  }, 60000);
  chatCleanupTimer.unref();
  server.listen(config.port, () =>
    console.log(`Blackjack Arena backend ready on port ${config.port}.`),
  );
  async function shutdown() {
    clearInterval(chatCleanupTimer);
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
