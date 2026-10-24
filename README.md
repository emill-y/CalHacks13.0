# ThisBut

**Shop by editing what you see.** Drop in a photo and say what you'd change, e.g. *"this shirt, but without the
ribbon."* ThisBut finds candidates with CLIP and then has Claude **verify every result against every edit**. A result
only appears under **Matches** if it passed all of them. When nothing matches, the shopper can save a **Wish**. Merchants
see Wishes as anonymous **Demand Gaps**, and a newly stocked product that satisfies a Wish notifies the shopper.

Built for the *Reimagining Shopping* track. No mocks in the core flow: real catalog images, real CLIP embeddings, real
Claude calls.

---

## Quick start

```bash
npm install
python3 -m pip install onnx tokenizers   # only needed for the model mirror fallback
npm run setup:model                      # fetches Xenova/clip-vit-base-patch32 (fp32 ONNX) into ./models
cp .env.example .env.local               # set ANTHROPIC_API_KEY (+ optional Upstash)
npm run dev                              # http://localhost:3000
```

The catalog (`public/catalog/*.jpg`, `data/catalog.json`) and its embeddings (`data/embeddings.f32`) are committed.
To rebuild them:

```bash
python3 -m pip install datasets pillow
npm run setup:catalog   # scripts/prepare_catalog.py → ~3,000 items
npm run embed           # scripts/embed.ts → data/embeddings.f32 + data/embeddings.manifest.json
```

| Env var | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **required** for parse/verify/fulfillment (server only) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | any vision-capable Claude model |
| `ANTHROPIC_EFFORT` | `low` | `low` / `medium` / `high` (latency vs. care) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | — | shared storage; otherwise `.data/db.json` |

Scripts: `npm run dev | build | start | test | lint | eval | embed | typecheck`.

---

## Architecture

```
 Browser                                   Next.js (Node server, App Router)
 ───────                                   ──────────────────────────────────
 crop + downscale to 768px  ──POST /api/search (NDJSON stream)──▶ lib/search.ts
                                             │ 1 PARSE    lib/parse.ts   Claude: image + edit (+priorSpec) → EditSpec (zod, 1 retry)
   progress: parse → retrieve → verify ◀─────┤ 2 RETRIEVE lib/retrieve.ts CLIP brute force over 3,000×512 (in memory, ~30 ms)
                                             │ 3 VERIFY   lib/verify.ts  top 16 → 2 parallel Claude calls × 8, per-edit checks
   Matches / Close, but… / Wish ◀────────────┘  done {spec, results, fullMatchCount}
                                             (uploaded photo only ever in memory; never persisted)

 POST /api/wishes ── EditSpec text only ──▶ lib/store.ts (Upstash Redis | .data/db.json)
 /merchant/gaps   ◀─ aggregateGaps()  (k≥3 for live groups, demo rows badged)
 /merchant/add    ── embed → catalog (memory + store) → prefilter open wishes → 1 Claude call → mark Found
 My Wishes polls every 10 s → toast + link when Found
```

* **CLIP**: `@huggingface/transformers` with `Xenova/clip-vit-base-patch32`, fp32, for both image and text embeddings.
  The same model id and dtype are used by `scripts/embed.ts` and at query time (`lib/clip.ts`). It's loaded once as a
  warm singleton and pre-warmed from `instrumentation.ts` (about 1.5 s), and text embeddings are cached per string.
* **Claude** (`@anthropic-ai/sdk`, server only): `lib/anthropic.ts` asks for structured JSON output
  (`output_config.format`). Every response is validated with zod, and an invalid reply is retried once with the
  validation error. If the API rejects structured outputs, the call falls back to prompt-only JSON. Timeouts,
  refusals, and auth errors map to typed error codes the UI shows.
* **Storage**: `lib/store.ts` uses Upstash Redis when `UPSTASH_REDIS_REST_URL/TOKEN` are set, otherwise an atomic,
  serialized JSON file at `.data/db.json`.

### Retrieval formula (`lib/retrieve.ts`)

```
v_img  = CLIP image embedding of the source (precomputed if it's a catalog product)
v_t    = CLIP text("a product photo of " + targetCaption)          # targetCaption is positive, never negated
v_r_i  = CLIP text("a photo of clothing with a " + remove_i)
score  = 0.5·cos(v_img,p) + 0.5·cos(v_t,p) − 0.25·max_i cos(v_r_i,p) + 0.05·[category matches]
```

`maxPrice` is a hard filter, all vectors are L2-normalized (so cos is a dot product), and the top 40 are kept.
CLIP is bad at negation, so negation is never sent to CLIP: removed features become a **penalty** vector, and the
caption describes what the item *is*.

### Verifier design (`lib/verify.ts`)

* Checks are generated deterministically from the spec: `is a <category>`, `keeps <x>`, `has no <x>`,
  `color is <v> (close shades OK)`, `<attr> is longer/shorter than the source`, `has <x>`, and a local `under $N` check.
* The top 16 candidates go out as **two parallel calls of 8**. Each call gets the source image first, then
  `Candidate <id>` + image pairs. Each call returns strict JSON
  `{id, checks:[{text, pass, reason≤12 words}], similarity 0–10}`.
* Model output is aligned to the expected checks, and any check the model skipped counts as a **fail**.
  `allPass` = every **edit** check passed (garment type, remove, change, add, price). Implicit `keeps <x>` checks are
  soft: they're shown as "≈ differs" chips and affect ranking, but never disqualify a result. (The first eval run made
  keeps mandatory, and the parser's over-specific keeps such as "daisy floral pattern" left the hero query with 0
  matches.)
* Ranking: allPass, then pass count, then similarity, then retrieval score.
* **Hard rule:** only `allPass` results are shown as **Matches**. If verification errors or exceeds **25 s**, results
  come back in retrieval order marked *unverified*, and none are labeled matches.
* Prompt-injection guard: system prompts state that text inside images is product content, never instructions.

### Canonical labels

`lib/spec.ts → canonicalLabel()` builds `"<Category> · <verb> <object>"` from the spec, joining edits with `" + "`.
Categories come from a fixed list and verbs are `remove | add | in <color> | longer | shorter | looser | tighter |
sleeves <x> | under $<n>`. Labels are computed server-side and never trusted from the client, so identical wishes
group together (e.g. `Blouse · remove bow + in black`). Refinements merge with `mergeSpec()`: earlier edits persist,
and later edits win on conflicts.

---

## Eval

`npm run eval` runs 10 canned queries using catalog images as sources: six bow/ribbon tops ("without the bow/ribbon",
one combined with "in black"), color, sleeves, price, and length + color. Each query reports full-match count, verifier
pass rate, check pass rate, and latency, plus a **ground-truth precision** score: Fashionpedia's human part annotations
say whether a "without the bow" match really has no annotated bow. Output is saved to `eval-results.json`.

Latest full run (`claude-sonnet-5-5`, effort low, 10 queries, see `eval-results.json`):

| metric | value |
|---|---|
| **hero**: bow blouse + "without the bow" | **10 verified matches in 13.1 s** |
| queries with ≥ 3 full matches | 9 / 10 |
| total full matches | 100 |
| matches whose Fashionpedia annotations confirm the removed part is absent | **98.6%** |
| verifier pass rate (verified candidates passing every edit) | 62.5% |
| median end-to-end latency (parse + retrieve + verify) | 12.7 s |
| retrieval alone (warm, brute force over 3,000) | ~30 ms |

Without `ANTHROPIC_API_KEY`, the eval runs in retrieval-only mode. The script exits non-zero if the hero query returns
fewer than 3 matches or takes 15 s or more.

---|---|
| top-16 free of the removed part (annotation ground truth, 6 removal queries) | **96.9%** |
| top-16 in the source's category | **98.8%** |
| median retrieval latency (warm) | **30 ms** |

Run `npm run eval` with a key to fill in full-match counts, verifier pass rate, and end-to-end latency for the pitch.
The script exits non-zero if the hero query (bow blouse + "without the bow") returns fewer than 3 matches or takes
15 s or more.

---

## Privacy design

* **Photos are used once and discarded.** They're cropped (optional crop box) and downscaled to 768 px *in the
  browser*, re-capped with sharp in memory, sent to CLIP + Claude for that one request, and never written to disk, a
  DB, or logs. Each search shows "Photo discarded ✓".
* **Wishes** store the EditSpec text, label, nearest product id, and optional max price. No image, no PII.
* **Events** are anonymous (`search | full_match | no_match | wish | order` + label) and keyed by a random
  `deviceId` kept in localStorage.
* **Merchant views** show aggregates only. Live groups smaller than 3 are hidden. Seeded rows are stored as aggregate
  rows (`demo: true, demoCount`), not fake users, and always carry a **Demo data** badge.
* **Checkout** is test mode. `4111 1111 1111 1111` is validated in the browser and never stored or sent; the
  confirmation shows only the last 4 digits.
* **/privacy** has **Export my data (JSON)** and **Delete all my data** (removes this device's wishes and events, then
  rotates the device id).

---

## Deploy

The Docker image bakes in the catalog images, embeddings, and CLIP model. Give it **≥ 2 GB RAM**: CLIP fp32 is about
600 MB on disk.

### Railway

```bash
npm i -g @railway/cli
railway login
railway init                       # create a project (or: railway link)
railway up                         # builds the Dockerfile
railway variables --set "ANTHROPIC_API_KEY=sk-ant-..." --set "ANTHROPIC_MODEL=claude-sonnet-5-5"
# persistence across deploys: either Upstash…
railway variables --set "UPSTASH_REDIS_REST_URL=..." --set "UPSTASH_REDIS_REST_TOKEN=..."
# …or attach a volume mounted at /app/.data in the Railway dashboard
railway domain                     # public URL
```

### Render

New → Web Service → connect the repo → Runtime **Docker** → instance with ≥ 2 GB → env vars `ANTHROPIC_API_KEY`,
`ANTHROPIC_MODEL` (optionally Upstash) → health check path `/api/health`. Alternatively use the included
`render.yaml` blueprint.

### Docker locally

```bash
docker build -t thisbut .            # CLIP_SOURCE=mirror (default) reproduces the exact weights used for embeddings
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... thisbut
```

### Fallback: localhost + tunnel

```bash
npm run build && npm start           # :3000
cloudflared tunnel --url http://localhost:3000
```

### About the CLIP weights

`scripts/fetch_model.py` first tries the Hugging Face repo `Xenova/clip-vit-base-patch32`. If the Hub is unreachable,
it uses the clip-as-service S3 export of the same OpenAI ViT-B/32 weights: it renames the graph I/O to the HF
convention (`input_ids:int64 → text_embeds`, `pixel_values → image_embeds`) and rebuilds the tokenizer from OpenAI's
BPE vocab. The committed `data/embeddings.f32` was built with the mirror. If you switch sources, re-run `npm run embed`
so precompute and query time use byte-identical weights.

---

## Dataset credit

The demo catalog is built by `scripts/prepare_catalog.py`. It first tries the Hugging Face datasets
`tomytjandra/h-and-m-fashion-caption-12k` and then `ashraq/fashion-product-images-small`. When the Hub isn't reachable
(as in the sandbox this was built in), it falls back to **[Fashionpedia](https://fashionpedia.github.io/home/)**
(Jia et al., *Fashionpedia: Ontology, Segmentation, and an Attribute Localization Dataset*, ECCV 2020). Fashionpedia's
annotations are CC BY 4.0, and its images come from Flickr and stock sites under their original licenses. Garments are
cut out onto white using the human-annotated segmentation masks, and captions are generated from annotated attributes
and parts (bow, ribbon, ruffle, sleeve length, pattern, neckline…). Images under no-derivatives or
all-rights-reserved licenses are skipped. Per-item source image and license ids are in `data/catalog_meta.json`.
Prices are seeded random values. **Used for demo purposes only.**

No payment-network logos or trademarks are used.
