// Baseline API (v1): the known-good version everything is compared against.
import { BASELINE_BEHAVIOR, buildApp, startServer } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
await startServer(buildApp(BASELINE_BEHAVIOR), port);
