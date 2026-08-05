// OpenRouter's live model catalog.
//
// pi ships a static OpenRouter catalog, but it is baked at release time while OpenRouter adds
// models continuously (303 baked vs 339 live at time of writing). The picker therefore reads the
// live list, and falls back to pi's catalog when the fetch fails so an OpenRouter outage degrades
// the model list rather than emptying it.
//
// Note the split: this list drives *discovery* only. Once a model is configured, the request path
// still resolves its metadata through catalogModel() in ai-models.ts, so a model that is live but
// absent from pi's catalog is usable but gets synthesized defaults (and, failing closed, no
// reasoning control).

import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import type { OpenRouterModel } from "@gadgets/workshop-shared/api";
import { createWorkshopLogger } from "./observability";

const logger = createWorkshopLogger("workshop.openrouter");

const MODELS_URL = "https://openrouter.ai/api/v1/models";

// The catalog changes on the order of days; half an hour keeps the picker fresh without making a
// model list depend on a third-party round trip. Cached per isolate -- there is no correctness
// requirement that every isolate agree, and a stale entry costs nothing but a missing new model.
const CACHE_TTL_MS = 30 * 60 * 1000;

let cache: { fetchedAt: number, models: OpenRouterModel[] } | undefined;

// OpenRouter's /models record, narrowed to the fields we read.
type RawModel = {
  id?: unknown,
  name?: unknown,
  context_length?: unknown,
  supported_parameters?: unknown,
  top_provider?: { max_completion_tokens?: unknown } | null,
  pricing?: { prompt?: unknown, completion?: unknown, input_cache_read?: unknown } | null,
};

// OpenRouter prices per token as decimal strings ("0.00000009"); ModelCost is per million tokens.
// Returns undefined for absent/unparseable/negative values rather than coercing to 0, so "unknown
// price" stays distinguishable from "free" -- they bill very differently.
export function perMillionTokens(price: unknown): number | undefined {
  if (typeof price !== "string" && typeof price !== "number") return undefined;
  const parsed = typeof price === "number" ? price : Number.parseFloat(price);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed * 1_000_000;
}

// Maps one OpenRouter record. Returns undefined when the record lacks the identity fields a
// picker entry needs; everything else degrades to undefined rather than dropping the model.
export function mapOpenRouterModel(raw: RawModel): OpenRouterModel | undefined {
  if (typeof raw?.id !== "string" || raw.id === "") return undefined;

  const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const contextWindow = typeof raw.context_length === "number" && raw.context_length > 0
      ? raw.context_length : undefined;
  const maxTokens = typeof raw.top_provider?.max_completion_tokens === "number"
      ? raw.top_provider.max_completion_tokens : undefined;

  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name !== "" ? raw.name : raw.id,
    contextWindow,
    maxTokens,
    // OpenRouter advertises the knob it accepts; that is what decides whether a reasoning control
    // is meaningful for this model.
    reasoning: params.includes("reasoning") || params.includes("reasoning_effort"),
    inputCost: perMillionTokens(raw.pricing?.prompt),
    outputCost: perMillionTokens(raw.pricing?.completion),
    cacheReadCost: perMillionTokens(raw.pricing?.input_cache_read),
  };
}

// pi's baked catalog in the same shape, used when the live fetch fails.
function staticCatalog(): OpenRouterModel[] {
  return Object.values(OPENROUTER_MODELS).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning === true,
    inputCost: model.cost?.input,
    outputCost: model.cost?.output,
    cacheReadCost: model.cost?.cacheRead,
  }));
}

export async function listOpenRouterModels(now = Date.now()): Promise<OpenRouterModel[]> {
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.models;

  try {
    // The catalog endpoint is public; no key is needed to browse models.
    const response = await fetch(MODELS_URL, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`OpenRouter models returned ${response.status}`);

    const payload = await response.json() as { data?: unknown };
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const models = rows
        .map((row) => mapOpenRouterModel(row as RawModel))
        .filter((model): model is OpenRouterModel => model !== undefined)
        .sort((a, b) => a.id.localeCompare(b.id));

    // An empty or unrecognizable payload is a failure, not an empty catalog -- keep the fallback
    // rather than caching nothing for half an hour.
    if (models.length === 0) throw new Error("OpenRouter models payload was empty");

    cache = { fetchedAt: now, models };
    return models;
  } catch (err) {
    logger.warn("Falling back to the baked OpenRouter catalog", {
      event: "openrouter.catalog.fetch_failed",
      error: err instanceof Error ? err.message : String(err),
    });
    // Serve a stale cache in preference to the baked list; both beat an empty picker.
    return cache?.models ?? staticCatalog();
  }
}
