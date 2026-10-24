import path from "node:path";
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  env,
  type PreTrainedTokenizer,
  type Processor,
  type PreTrainedModel,
} from "@huggingface/transformers";

/** Same model id + dtype in scripts/embed.ts and at query time. */
export const CLIP_MODEL_ID = "Xenova/clip-vit-base-patch32";
export const CLIP_DTYPE = "fp32" as const;
export const EMBED_DIM = 512;

env.localModelPath = path.join(process.cwd(), "models");
env.allowLocalModels = true;
// The model is fetched once by scripts/fetch_model.py; never download at request time.
env.allowRemoteModels = process.env.CLIP_ALLOW_REMOTE === "1";

interface Clip {
  tokenizer: PreTrainedTokenizer;
  processor: Processor;
  text: PreTrainedModel;
  vision: PreTrainedModel;
}

const g = globalThis as unknown as { __clip?: Promise<Clip>; __textCache?: Map<string, Float32Array> };

export function loadClip(): Promise<Clip> {
  if (!g.__clip) {
    g.__clip = (async () => {
      const opts = { dtype: CLIP_DTYPE, device: "cpu" as const };
      const [tokenizer, processor, text, vision] = await Promise.all([
        AutoTokenizer.from_pretrained(CLIP_MODEL_ID),
        AutoProcessor.from_pretrained(CLIP_MODEL_ID, {}),
        CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL_ID, opts),
        CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL_ID, opts),
      ]);
      return { tokenizer, processor, text, vision };
    })().catch((e) => {
      g.__clip = undefined;
      throw new Error(
        `CLIP model failed to load from ./models (run \`npm run setup:model\`): ${(e as Error).message}`,
      );
    });
  }
  return g.__clip;
}

export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

function rows(data: Float32Array, n: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < n; i++) out.push(l2normalize(data.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM)));
  return out;
}

/** L2-normalized image embeddings for encoded image bytes (jpeg/png/webp). */
export async function embedImages(buffers: Buffer[]): Promise<Float32Array[]> {
  const clip = await loadClip();
  const images = await Promise.all(
    buffers.map((b) => RawImage.fromBlob(new Blob([new Uint8Array(b)]))),
  );
  const inputs = await clip.processor(images);
  const { image_embeds } = await clip.vision(inputs);
  return rows(image_embeds.data as Float32Array, buffers.length);
}

export async function embedImage(buffer: Buffer): Promise<Float32Array> {
  return (await embedImages([buffer]))[0];
}

/** L2-normalized text embeddings, cached per string (Phase 3 speed). */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const cache = (g.__textCache ??= new Map());
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (missing.length) {
    const clip = await loadClip();
    const inputs = clip.tokenizer(missing, { padding: "max_length", truncation: true, max_length: 77 });
    const { text_embeds } = await clip.text(inputs);
    rows(text_embeds.data as Float32Array, missing.length).forEach((v, i) => {
      if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
      cache.set(missing[i], v);
    });
  }
  return texts.map((t) => cache.get(t)!);
}

export async function embedText(text: string): Promise<Float32Array> {
  return (await embedTexts([text]))[0];
}

export function cosine(a: Float32Array, b: Float32Array, bOffset = 0): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[bOffset + i];
  return s;
}
