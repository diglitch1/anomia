import { resolve } from "node:path";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import type { GemmaProvider } from "./gemma/types.js";
import { errorHandler, HttpError, requestLog } from "./http.js";
import type { Integrations } from "./integrations.js";
import { rateLimit } from "./rateLimit.js";
import { createSuggestRouter } from "./routes/suggest.js";

export function createApp(provider: GemmaProvider, integrations: Integrations): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);
  app.use(requestLog);
  app.use(
    cors({
      origin: (origin, done) => done(null, !origin || config.allowedOrigins.includes(origin)),
      exposedHeaders: ["x-anomia-path", "x-anomia-stt"],
    }),
  );

  // Before the rate limiter so platform health probes never get throttled.
  app.get("/api/health", (_req, res) => {
    if (!provider.model) {
      res.status(503).json({ ok: false, model: null, provider: provider.name, error: "Model is not available" });
      return;
    }
    res.json({ ok: true, model: provider.model, provider: provider.name });
  });

  app.use("/api", rateLimit(config.rateLimitPerMinute));
  app.use(express.json({ limit: config.maxBodyBytes }));

  app.use("/api", createSuggestRouter(provider, integrations));
  if (integrations.voiceRouter) {
    app.use("/api", integrations.voiceRouter);
  } else {
    app.post(["/api/speak", "/api/voice/clone"], (_req, _res, next) =>
      next(new HttpError(501, "Speech module is not available")),
    );
  }

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));
  // Lets one server and one HTTPS tunnel carry both the API and the built web app.
  if (config.webDist) {
    const root = resolve(config.webDist);
    app.use(express.static(root));
    app.get(/.*/, (_req, res) => res.sendFile("index.html", { root }));
  }
  app.use(errorHandler);
  return app;
}
