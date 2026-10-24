import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const EFFORT = (process.env.ANTHROPIC_EFFORT || "low") as "low" | "medium" | "high";

export class ModelError extends Error {
  constructor(
    message: string,
    public code: "missing_api_key" | "model_error" | "timeout" | "invalid_output" | "refusal",
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;
export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
function getClient() {
  if (!hasApiKey()) {
    throw new ModelError("ANTHROPIC_API_KEY is not set on the server.", "missing_api_key");
  }
  client ??= new Anthropic({ maxRetries: 1 });
  return client;
}

export type ImageInput = { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };
export type Part = { text: string } | { image: ImageInput };

function toBlocks(parts: Part[]): Anthropic.ContentBlockParam[] {
  return parts.map((p) =>
    "text" in p
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "base64", media_type: p.image.mediaType, data: p.image.data } },
  );
}

/** First {...} or [...] JSON value in a string (tolerates code fences). */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/g, "").trim();
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error("no JSON in model output");
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("unterminated JSON in model output");
}

interface JsonCall<T> {
  system: string;
  parts: Part[];
  schema: z.ZodType<T>;
  /** JSON schema for structured outputs (strict subset); prompt-only JSON if the API rejects it */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

let structuredSupported = true;
// Short, latency-sensitive JSON calls: turn thinking off where the model supports it
// (Sonnet 5.5: {type:"between_tools"}). Dropped automatically if the API rejects it.
let thinkingOffSupported = process.env.ANTHROPIC_THINKING !== "on" && /^claude-sonnet-5-5/.test(MODEL);

async function once<T>(call: JsonCall<T>, extra?: string): Promise<T> {
  const c = getClient();
  const content = toBlocks(extra ? [...call.parts, { text: extra }] : call.parts);
  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: call.maxTokens ?? 4000,
    system: call.system,
    messages: [{ role: "user", content }],
    ...(thinkingOffSupported ? ({ thinking: { type: "between_tools" } } as unknown as object) : {}),
    output_config: {
      effort: EFFORT,
      ...(call.jsonSchema && structuredSupported
        ? { format: { type: "json_schema", schema: call.jsonSchema } }
        : {}),
    },
  };
  let res: Anthropic.Message;
  try {
    res = await c.messages.create(body, { timeout: call.timeoutMs ?? 30_000, signal: call.signal });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && thinkingOffSupported) {
      thinkingOffSupported = false;
      return once(call, extra);
    }
    if (e instanceof Anthropic.BadRequestError && body.output_config?.format) {
      // Older model/API without structured outputs: fall back to prompt-only JSON.
      structuredSupported = false;
      return once(call, extra);
    }
    if (e instanceof Anthropic.AuthenticationError) {
      throw new ModelError("ANTHROPIC_API_KEY was rejected.", "missing_api_key");
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError || (e as Error).name === "AbortError") {
      throw new ModelError("Model call timed out.", "timeout");
    }
    if (e instanceof Anthropic.APIError) {
      throw new ModelError(`Model error ${e.status ?? ""}: ${e.message}`.slice(0, 300), "model_error");
    }
    throw e;
  }
  if (res.stop_reason === "refusal") throw new ModelError("The model declined this request.", "refusal");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = call.schema.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new ModelError(`invalid JSON shape: ${parsed.error.message.slice(0, 400)}`, "invalid_output");
  }
  return parsed.data;
}

/** Call Claude for STRICT JSON, validate with zod, retry once with the validation error. */
export async function callJson<T>(call: JsonCall<T>): Promise<T> {
  try {
    return await once(call);
  } catch (e) {
    if (e instanceof ModelError && e.code !== "invalid_output" && e.code !== "model_error") throw e;
    if (!(e instanceof ModelError) && !(e instanceof SyntaxError) && !String(e).includes("JSON")) throw e;
    return once(
      call,
      `Your previous reply was not valid: ${(e as Error).message.slice(0, 300)}. Reply with ONLY the corrected JSON.`,
    );
  }
}
