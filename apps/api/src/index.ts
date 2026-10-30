import { createApp } from "./app.js";
import { config } from "./config.js";
import { createProvider } from "./gemma/index.js";
import { describeError } from "./http.js";
import { loadIntegrations } from "./integrations.js";

const provider = createProvider(config.gemmaProvider);
const integrations = await loadIntegrations();

createApp(provider, integrations).listen(config.port, () => {
  console.log(`anomia api listening on :${config.port}`);
});

// Stays up on failure: /api/health reports 503 and the next /api/suggest tries again.
provider.init().catch((error: unknown) => {
  console.error(`gemma provider init failed: ${(error as Error).message || describeError(error)}`);
});
