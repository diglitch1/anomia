# Anomia

Anomia helps people with aphasia say what they mean, in their own voice. Aphasia takes away words, not thoughts: a person may only manage "wa... cup... hot... no" while knowing exactly what they want to say. Anomia combines those fragments with what the phone camera sees, a small personal profile and recent choices. **Gemma 4**, an open-weight model, turns that into three candidate sentences. The person taps one, and ElevenLabs speaks it in their own cloned voice.

Built for the MLH Hacktoberfest Hack Day Linz, "Best Open-Source AI Project" challenge.

## 60-second demo

1. Open the app on a phone and allow camera and microphone.
2. Point the camera at a mug and say: "wa... cup... hot... no".
3. Three sentences appear, for example "The cup is too hot." or "I want some water instead."
4. Tap one. Only now is audio generated, and the phone says it out loud.
5. Optional: record a voice sample, confirm consent, and hear sentences in that voice.

## Architecture

```text
 Phone PWA (apps/web)
   | fragments + photo + profile + recent picks
   v
 POST /api/suggest ---> Gemma provider ---> Gemini API, or Ollama (local)
   |                        |
   |                        | no audio support, audio refused or nothing heard
   |                        v
   |                    ElevenLabs Speech-to-Text, resent to Gemma as text
   v
 three sentences shown; the user taps one
   |
   v
 POST /api/speak ------> ElevenLabs Text-to-Speech ---> audio/mpeg

 POST /api/voice/clone -> ElevenLabs Instant Voice Cloning (consent=true required)
```

The API (`apps/api`) is stateless: no database, and no personal data on disk or in logs. The frontend (`apps/web`) was built with Lovable and keeps the profile only on the device.

## The AI

| | |
|---|---|
| **Model family** | Gemma 4 by Google DeepMind, open weights |
| **Hosted model (Gemini API)** | `gemma-4-26b-a4b-it`: Gemma 4 26B A4B, 25.2B total parameters, 3.8B active, no audio encoder, so speech is transcribed first |
| **Preferred model** | Gemma 4 E4B: 4.5B effective parameters (8B with embeddings), built-in audio encoder. Not offered on our Gemini API key at the time of writing |
| **Local id (Ollama)** | `gemma4:e4b` |
| **Model selection** | chosen at startup from the live models list, E4B first. The exact id in use is always shown at `GET /api/health` |
| **License** | Apache 2.0: [license text](https://ai.google.dev/gemma/apache_2) |
| **Model card** | [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) |

If E4B is not offered on the Gemini API, the server uses the smallest Gemma 4 model that is. It only ever selects Gemma 4; closed models are refused by code and tests ([models.ts](apps/api/src/gemma/models.ts)).

- **Gemma 4** writes every sentence suggestion from speech, scene, profile and recent picks.
- **ElevenLabs** provides voice output, voice cloning and the speech-to-text fallback. It never writes suggestions.

The prompt is in [prompt.ts](apps/api/src/gemma/prompt.ts).

## Run locally

Hosted Gemma through the Gemini API, with Node 20:

```bash
git clone https://github.com/diglitch1/anomia.git && cd anomia/apps/api
cp .env.example .env   # add GEMINI_API_KEY, ELEVENLABS_API_KEY, DEFAULT_VOICE_ID
npm install
npm run dev
curl http://localhost:8787/api/health
```

Then start the frontend in a second terminal:

```bash
cd apps/web && cp .env.example .env && npm install && npm run dev
```

Test all fixtures against the running API:

```bash
cd apps/api && npm run test:suggest
```

### Local model with Ollama

Gemma runs on your machine. The first start downloads about 7 GB.

```bash
docker compose up --build
```

Without Docker: `ollama pull gemma4:e4b`, then set `GEMMA_PROVIDER=ollama` in `apps/api/.env`.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMMA_PROVIDER` | no | `gemini` (default) or `ollama` |
| `GEMINI_API_KEY` | for `gemini` | Gemini API access |
| `GEMMA_MODEL` | no | Force a listed Gemma 4 model id |
| `OLLAMA_URL` | no | Default `http://localhost:11434` |
| `OLLAMA_MODEL` | no | Default `gemma4:e4b` |
| `ELEVENLABS_API_KEY` | yes | Speech, cloning, speech-to-text |
| `DEFAULT_VOICE_ID` | yes | Voice used for `voiceId: "default"` |
| `ALLOWED_ORIGINS` | yes | Comma-separated CORS allowlist |
| `PORT` | no | Default `8787` |
| `TRUST_PROXY_HOPS` | no | Proxies in front of the API; `1` on App Platform |
| `GEMINI_TIMEOUT_MS`, `OLLAMA_TIMEOUT_MS` | no | Model request timeouts |
| `VITE_API_URL` | yes (web) | Base URL of the API, without `/api` |

## API

| Endpoint | Input | Output |
|---|---|---|
| `GET /api/health` | | `{ok, model, provider}`, 503 until the model is ready |
| `POST /api/suggest` | multipart: `audio`, `image?`, `profile?`, `recentPicks?` | `{transcriptGuess, suggestions[3], sceneTag?}` |
| `POST /api/speak` | JSON: `text` (max 300 chars), `voiceId` | `audio/mpeg` |
| `POST /api/voice/clone` | multipart: `samples` (1-5), `name`, `consent` | `{voiceId}` |

Errors are JSON: `{error}`. Limit: 30 requests per minute per IP. The debug header `x-anomia-path` shows `audio` or `stt`; `x-anomia-stt: failed` means speech-to-text failed and suggestions rest on the scene and profile alone.

## Deploy to DigitalOcean

HTTPS is mandatory for camera and microphone. App Platform provides it automatically.

1. Authorize App Platform for the GitHub repo in the DigitalOcean dashboard.
2. Create the app:

   ```bash
   doctl auth init
   doctl apps create --spec .do/app.yaml
   ```

3. In the dashboard, open the app, then Settings, then the `api` component, and set `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` and `DEFAULT_VOICE_ID` as encrypted values. Saving redeploys the app.
4. Check `https://<your-app>.ondigitalocean.app/api/health`.

Without doctl: Create App, choose the repo, then paste `.do/app.yaml` in the App Spec editor.

## Privacy and safety

- **Stateless:** no database. Audio, images, transcripts, profiles and sentences are never stored or logged. Logs hold timing, status codes and provider error types only.
- **Third parties:** audio, photos and text are sent to the Gemini API and ElevenLabs to process a request, under their terms. With Ollama, Gemma runs locally, but speech-to-text and voice output still use ElevenLabs.
- **Never speaks on its own:** `/api/suggest` returns text only. Audio is produced only after a tap.
- **Consent for cloning:** `/api/voice/clone` refuses requests without `consent=true` and accepts only direct uploads, never a URL.
- **Not a medical device:** Anomia is a communication aid prototype. It does not diagnose or treat, and should not be relied on in emergencies.

## Known limitations

- Hosted Gemma on the Gemini API can take 20 s or more and sometimes returns server errors, so the API asks all available Gemma 4 models in parallel, asks again every 12 s, and uses the first answer. The 4 s target is not met on this path.
- Suggestions can be wrong; the person always chooses, and nothing is spoken without a tap.
- Models without an audio encoder, and Ollama, depend on speech-to-text, which may struggle with fragments and adds latency.
- The Ollama variant is not fully offline, because speech-to-text and voice output need ElevenLabs.
- The rate limit is in-memory and per instance.
- Tested with synthetic fixtures, not yet with people with aphasia.

## Team

Built at MLH Hacktoberfest Hack Day Linz by the Anomia team.

## License

[MIT](LICENSE). Gemma 4 is licensed separately under [Apache 2.0](https://ai.google.dev/gemma/apache_2).
