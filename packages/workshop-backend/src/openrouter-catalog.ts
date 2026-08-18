// OpenRouter's live model catalog, for the model picker.
//
// pi bundles an OpenRouter catalog, but it is baked at release time while OpenRouter adds models
// continuously (303 bundled vs ~340 live). This fetches the live list and falls back to the
// bundled one, so an outage degrades the picker rather than emptying it.
//
// Discovery only: what a configured model needs at request time is captured by addModel into
// AiModelConfig.capabilities, which catalogModel() merges with the bundled catalog.

import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import type { ProviderModel } from "@gadgets/workshop-shared/api";
import { createWorkshopLogger } from "./observability";

const logger = createWorkshopLogger("workshop.openrouter");

const MODELS_URL = "https://openrouter.ai/api/v1/models";

// The catalog changes on the order of days; half an hour keeps the picker fresh without making a
// model list depend on a third-party round trip. Cached per isolate -- there is no correctness
// requirement that every isolate agree, and a stale entry costs nothing but a missing new model.
const CACHE_TTL_MS = 30 * 60 * 1000;

// Shorter, so an outage does not suppress the real catalog for a full half hour.
const FAILURE_TTL_MS = 60 * 1000;

let cache: { fetchedAt: number, ttlMs: number, models: Promise<ProviderModel[]> } | undefined;

// OpenRouter's /models record, narrowed to the fields we read.
type RawModel = {
  id?: unknown,
  name?: unknown,
  context_length?: unknown,
  supported_parameters?: unknown,
  top_provider?: { max_completion_tokens?: unknown },
  pricing?: { prompt?: unknown, completion?: unknown, input_cache_read?: unknown },
};

/**
 * OpenRouter prices per token as decimal strings ("0.00000009"); ModelCost is per million tokens.
 * Returns undefined for absent/unparseable/negative values rather than coercing to 0, so "unknown
 * price" stays distinguishable from "free" -- they bill very differently.
 */
export function perMillionTokens(price: unknown): number | undefined {
  if (typeof price !== "string") return undefined;
  const parsed = Number.parseFloat(price);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : undefined;
}

/**
 * The model registry's cost shape. Omitted entirely when OpenRouter published no usable price, so
 * "unknown" stays distinguishable from free -- a missing price must never read as $0 spend.
 */
export function costOf(pricing: RawModel["pricing"]): ProviderModel["cost"] {
  const input = perMillionTokens(pricing?.prompt);
  const output = perMillionTokens(pricing?.completion);
  if (input === undefined && output === undefined) return undefined;
  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead: perMillionTokens(pricing?.input_cache_read) ?? 0,
    cacheWrite: 0,
  };
}

/**
 * Maps one OpenRouter record. Returns undefined when the record lacks the identity fields a
 * picker entry needs, or when the model cannot do tool calling; everything else degrades to an
 * undefined field rather than dropping the model.
 */
export function mapProviderModel(raw: RawModel): ProviderModel | undefined {
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
    // Workshop's agent is entirely tool-driven, so this decides whether a model is usable at all.
    // Reported rather than filtered here: the Model ID field accepts free text, so a mapper-level
    // filter shrinks a dropdown without enforcing anything.
    tools: params.includes("tools"),
    cost: costOf(raw.pricing),
  };
}

// The bundled catalog in the same shape, for when the live fetch fails. Deliberately omits the
// metadata fields: these entries are keyed by model id, so anything served here is also found by
// catalogModel() on the request path -- capturing it onto a config would persist a copy that is
// always shadowed by its own source. `tools` is left undefined because the bundled entries carry
// no such flag, so this path reports "unknown" rather than guessing.
function staticCatalog(): ProviderModel[] {
  return Object.values(OPENROUTER_MODELS).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    reasoning: model.reasoning === true,
  }));
}

export function listProviderModels(now = Date.now()): Promise<ProviderModel[]> {
  if (cache && now - cache.fetchedAt < cache.ttlMs) return cache.models;

  const models = fetchCatalog()
      .then((fetched) => {
        cache = { fetchedAt: now, ttlMs: CACHE_TTL_MS, models: Promise.resolve(fetched) };
        return fetched;
      })
      .catch((err) => {
        logger.warn("Falling back to the bundled OpenRouter catalog", {
          event: "openrouter.catalog.fetch_failed",
          error: err instanceof Error ? err.message : String(err),
        });
        // Cache the failure too, on a short TTL. Without this every picker open during an
        // OpenRouter outage re-entered the fetch and blocked on the full timeout again.
        const fallback = staticCatalog();
        cache = { fetchedAt: now, ttlMs: FAILURE_TTL_MS, models: Promise.resolve(fallback) };
        return fallback;
      });

  // Store the in-flight promise so concurrent callers share one fetch rather than each issuing
  // their own; the handlers above replace it with the settled result and the real TTL.
  cache = { fetchedAt: now, ttlMs: CACHE_TTL_MS, models };
  return models;
}

async function fetchCatalog(): Promise<ProviderModel[]> {
  // The catalog endpoint is public; no key is needed to browse models. Bounded like the other
  // outbound third-party call in this codebase (ai-gateway.ts): the UI awaits this RPC, so a
  // black-holed route must fail fast rather than hold the request.
  const response = await fetch(MODELS_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`OpenRouter models returned ${response.status}`);

  const payload = await response.json() as { data?: unknown };
  const rows: RawModel[] = Array.isArray(payload?.data) ? payload.data : [];
  const models = rows
      .map(mapProviderModel)
      .filter((model): model is ProviderModel => model !== undefined)
      .toSorted((a, b) => a.id.localeCompare(b.id));

  // An empty or unrecognizable payload is a failure, not an empty catalog.
  if (models.length === 0) throw new Error("OpenRouter models payload was empty");
  return models;
}
