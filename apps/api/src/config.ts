// Node 20 has no --env-file-if-exists flag, so the optional .env is loaded here.
try {
  process.loadEnvFile();
} catch {
  // No .env file: production and Docker pass real environment variables.
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: intEnv("PORT", 8787),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
  trustProxyHops: intEnv("TRUST_PROXY_HOPS", 0),
  gemmaProvider: process.env.GEMMA_PROVIDER ?? "gemini",
  gemmaModel: process.env.GEMMA_MODEL?.trim() || undefined,
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || undefined,
  geminiTimeoutMs: intEnv("GEMINI_TIMEOUT_MS", 60_000),
  ollamaUrl: (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, ""),
  ollamaModel: process.env.OLLAMA_MODEL?.trim() || "gemma4:e4b",
  ollamaTimeoutMs: intEnv("OLLAMA_TIMEOUT_MS", 120_000),
  maxBodyBytes: 15 * 1024 * 1024,
  rateLimitPerMinute: 30,
};
