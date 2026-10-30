# Image notes

Owner: Person C (Image). Code: `apps/api/src/image/`.

## prepareImage defaults

| setting | env | default |
|---|---|---|
| longest side | `IMAGE_MAX_SIDE` | 768 px (never upscaled) |
| JPEG quality | `IMAGE_JPEG_QUALITY` | 80 |
| max upload | `IMAGE_MAX_INPUT_BYTES` | 15 MB (same as Core's `maxBodyBytes`) |
| max pixels | `IMAGE_MAX_INPUT_PIXELS` | 50 MP |
| max output | `IMAGE_MAX_OUTPUT_BYTES` | 400 KB (quality steps down to fit) |
| parallel decodes | `IMAGE_MAX_CONCURRENT` | 2 |
| timeout | `IMAGE_TIMEOUT_SECONDS` | 10 s |
| size/timing log | `IMAGE_LOG` | on (`0` turns it off) |

Measured locally, pinned to one CPU core (a stand-in for DigitalOcean basic-xxs): 12 MP phone photo → 44 ms, 48 MP → about 100 ms. Four parallel 48 MP uploads add about 35 MB of memory (sharp's shrink-on-load). At 768 px / q75 the output is 11–21 KB.

**Still open:** the Gemma 4 benchmark (`scripts/benchmark-image.ts`) has not run with a real `GEMINI_API_KEY`. Model latency, image tokens, recognition rates and the model ids seen will be added here, and the defaults may change.

## Face recognition (people the user enrolled)

Lets the suggestions name the person the user is talking to, e.g. "Tom, can you help me?" when Tom is in the photo.

**How it works**
- Models: OpenCV Zoo **YuNet 2023mar** (detection, MIT) and **SFace 2021dec** (128-d embedding, Apache-2.0), run on CPU with `onnxruntime-node`. Both are open weights, pinned by SHA-256 and downloaded with `npx tsx src/image/faces/download-models.ts` into `apps/api/models/faces` (or `FACE_MODELS_DIR`). They are never committed.
- `POST /api/faces/enroll`: multipart `image` + `consent=true` → `{ embedding: number[128], model: "sface-2021dec" }`. Rejects photos with no face, several faces, or a face under 80 px.
- `POST /api/faces/identify`: multipart `image` + `knownFaces` (JSON `[{name, embedding}]`, max 20) → `{ facesSeen, people: [{name, similarity}] }`.
- Library: `recognizeFaces(prepared.data, parseKnownFaces(raw))` for use inside `/api/suggest`.
- Without the model files, the endpoints answer 503 and nothing else is affected. Models load lazily on first use.

**Privacy (biometric data, GDPR Art. 9)**
- The server stays stateless: embeddings are returned to the phone and stored only there, inside the user's profile. The server never stores or logs photos, embeddings or names; logs show face counts and timing only.
- Enrollment requires `consent=true`, meaning *the person in the photo* agreed. The app must ask them, not only the user.
- The client should be able to delete an enrolled person, which simply removes their entry from the profile.
- Unknown faces are only counted, never described or identified.

**Measured** (public-domain historical portraits, kept locally and not committed)
- Same person across different photos: cosine similarity 0.47–0.89. Different people: at most 0.33. The SFace threshold of 0.363 (`FACE_MATCH_THRESHOLD`) separated every pair.
- Two-person composite, each enrolled from a different photo: both named correctly (0.69 and 0.48). A third enrolled person was not falsely matched.
- No faces were detected in the mug and window fixtures.
- Timing: enroll about 110–170 ms, recognise about 170 ms for two faces, 45 ms when there are no faces.
- Memory: about +155 MB once the models are loaded (about 260 MB total for the API on one core). This fits basic-xxs (512 MB), but watch it together with ffmpeg.
- The margin is modest (0.33 vs 0.363) with old black-and-white photos. Test with real phone photos of team members **who agree**, never committed, before relying on it in the demo.

**Prompt suggestion for Core**
Pass the matched names as `peopleInView` (e.g. `["Tom (son)"]`) and add to the system instruction:
> "peopleInView lists people recognised in the photo. When it is relevant, a suggestion may address or mention them by name. Never guess who an unnamed person is, and never describe faces or appearance."

Only send the names, never the similarity scores or embeddings.
