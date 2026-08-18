import { describe, expect, it } from "vitest";
import { orderDefaultModelFirst } from "../src/user.js";

const models = [
  { profile: { id: "cf-model", name: "Workers AI" } },
  { profile: { id: "claude-sonnet-5", name: "Claude Sonnet 5" } },
  { profile: { id: "gpt", name: "GPT" } },
];

describe("orderDefaultModelFirst", () => {
  it("moves the configured default to the front and keeps the rest in order", () => {
    expect(orderDefaultModelFirst(models, "claude-sonnet-5").map((m) => m.profile.id))
      .toEqual(["claude-sonnet-5", "cf-model", "gpt"]);
  });

  it("leaves the list alone when unset, unknown, or already first", () => {
    expect(orderDefaultModelFirst(models, undefined)).toBe(models);
    expect(orderDefaultModelFirst(models, "nope")).toBe(models);
    expect(orderDefaultModelFirst(models, "cf-model")).toBe(models);
    expect(orderDefaultModelFirst([], "claude-sonnet-5")).toEqual([]);
  });
});
