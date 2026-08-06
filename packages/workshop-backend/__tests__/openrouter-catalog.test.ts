import { describe, expect, it } from "vitest";
import { costOf, mapProviderModel, perMillionTokens } from "../src/openrouter-catalog.js";

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
    for (const value of [undefined, null, "", "n/a", {}, "-1"]) {
      expect(perMillionTokens(value)).toBeUndefined();
    }
  });

  it("omits cost entirely when no usable price was published", () => {
    expect(costOf({ input_cache_read: "0.000001" })).toBeUndefined();
    expect(costOf(undefined)).toBeUndefined();
  });
});

describe("mapProviderModel", () => {
  const RAW = {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    context_length: 163840,
    top_provider: { max_completion_tokens: 65536 },
    pricing: { prompt: "0.00000027", completion: "0.0000004", input_cache_read: "0.00000013" },
    supported_parameters: ["tools", "reasoning", "reasoning_effort"],
  };

  it("maps a complete record", () => {
    expect(mapProviderModel(RAW)).toEqual({
      id: "deepseek/deepseek-v3.2",
      name: "DeepSeek V3.2",
      contextWindow: 163840,
      maxTokens: 65536,
      reasoning: true,
      tools: true,
      cost: {
        input: expect.closeTo(0.27, 6),
        output: expect.closeTo(0.4, 6),
        cacheRead: expect.closeTo(0.13, 6),
        cacheWrite: 0,
      },
    });
  });

  it("derives reasoning support from the advertised parameters", () => {
    // This is what decides whether the composer offers a thinking control for the model.
    expect(mapProviderModel({ ...RAW, supported_parameters: ["tools"] })?.reasoning).toBe(false);
    expect(mapProviderModel({ ...RAW, supported_parameters: ["tools", "reasoning"] })?.reasoning)
        .toBe(true);
    expect(mapProviderModel({ ...RAW, supported_parameters: ["tools", "reasoning_effort"] })
        ?.reasoning).toBe(true);
  });

  it("reports tool capability instead of filtering on it", () => {
    // The agent loop is tool-driven, so this decides whether a model is usable -- but the Model
    // ID field takes free text, so filtering here would shrink a dropdown without enforcing
    // anything. Report it and let the picker decide.
    expect(mapProviderModel({ ...RAW, supported_parameters: ["reasoning"] })?.tools).toBe(false);
    expect(mapProviderModel({ ...RAW, supported_parameters: ["tools"] })?.tools).toBe(true);
  });

  it("keeps a model whose optional fields are missing", () => {
    // A sparse record still belongs in the picker; only the identity fields are required.
    expect(mapProviderModel({ id: "some/model" })).toEqual({
      id: "some/model",
      name: "some/model",
      contextWindow: undefined,
      maxTokens: undefined,
      reasoning: false,
      tools: false,
      cost: undefined,
    });
  });

  it("drops a record with no usable id", () => {
    expect(mapProviderModel({ name: "No ID" })).toBeUndefined();
    expect(mapProviderModel({ id: "" })).toBeUndefined();
    expect(mapProviderModel({ id: 42 })).toBeUndefined();
  });
});
