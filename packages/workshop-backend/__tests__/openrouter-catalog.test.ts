import { describe, expect, it } from "vitest";
import { mapOpenRouterModel, perMillionTokens } from "../src/openrouter-catalog.js";

// OpenRouter publishes prices as per-token decimal *strings*; ModelCost is per million tokens.
// That unit conversion is the most error-prone part of the mapping -- a missed factor of 1e6 is
// invisible until a cost readout is wrong by six orders of magnitude.
describe("perMillionTokens", () => {
  it("scales a per-token price string to per-million", () => {
    expect(perMillionTokens("0.00000009")).toBeCloseTo(0.09, 10);
    expect(perMillionTokens("0.000003")).toBeCloseTo(3, 10);
  });

  it("treats a free model as free, not as unknown", () => {
    expect(perMillionTokens("0")).toBe(0);
  });

  it("reports an unusable price as unknown rather than free", () => {
    // Distinct outcomes on purpose: a model with no published price must not read as $0, which
    // would silently understate spend.
    for (const value of [undefined, null, "", "n/a", {}, -1]) {
      expect(perMillionTokens(value)).toBeUndefined();
    }
  });
});

describe("mapOpenRouterModel", () => {
  const RAW = {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    context_length: 163840,
    top_provider: { max_completion_tokens: 65536 },
    pricing: { prompt: "0.00000027", completion: "0.0000004", input_cache_read: "0.00000013" },
    supported_parameters: ["tools", "reasoning", "reasoning_effort"],
  };

  it("maps a complete record", () => {
    expect(mapOpenRouterModel(RAW)).toEqual({
      id: "deepseek/deepseek-v3.2",
      name: "DeepSeek V3.2",
      contextWindow: 163840,
      maxTokens: 65536,
      reasoning: true,
      inputCost: expect.closeTo(0.27, 6),
      outputCost: expect.closeTo(0.4, 6),
      cacheReadCost: expect.closeTo(0.13, 6),
    });
  });

  it("derives reasoning support from the advertised parameters", () => {
    // This is what decides whether the composer offers a thinking control for the model.
    expect(mapOpenRouterModel({ ...RAW, supported_parameters: ["tools"] })?.reasoning).toBe(false);
    expect(mapOpenRouterModel({ ...RAW, supported_parameters: ["tools", "reasoning"] })?.reasoning)
        .toBe(true);
    expect(mapOpenRouterModel({ ...RAW, supported_parameters: ["tools", "reasoning_effort"] })
        ?.reasoning).toBe(true);
  });

  it("drops a model that cannot do tool calling", () => {
    // The agent loop is entirely tool-driven, so a non-tool model is unusable no matter how
    // capable it looks. Before this provider every offered model came from a curated list and
    // was implicitly tool-capable; an unfiltered catalog has to re-establish that.
    expect(mapOpenRouterModel({ ...RAW, supported_parameters: ["reasoning"] })).toBeUndefined();
    expect(mapOpenRouterModel({ ...RAW, supported_parameters: [] })).toBeUndefined();
    expect(mapOpenRouterModel({ ...RAW, supported_parameters: undefined })).toBeUndefined();
  });

  it("keeps a model whose optional fields are missing", () => {
    // A sparse record still belongs in the picker; only the identity fields are required.
    expect(mapOpenRouterModel({ id: "some/model", supported_parameters: ["tools"] })).toEqual({
      id: "some/model",
      name: "some/model",
      contextWindow: undefined,
      maxTokens: undefined,
      reasoning: false,
      inputCost: undefined,
      outputCost: undefined,
      cacheReadCost: undefined,
    });
  });

  it("drops a record with no usable id", () => {
    const tools = { supported_parameters: ["tools"] };
    expect(mapOpenRouterModel({ name: "No ID", ...tools })).toBeUndefined();
    expect(mapOpenRouterModel({ id: "", ...tools })).toBeUndefined();
    expect(mapOpenRouterModel({ id: 42, ...tools })).toBeUndefined();
  });
});
