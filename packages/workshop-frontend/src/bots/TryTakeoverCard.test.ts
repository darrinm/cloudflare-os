import { describe, expect, it } from "vitest";
import { normalizeSite, tryTakeoverTask } from "./TryTakeoverCard";

describe("normalizeSite", () => {
  it("keeps the host and nothing else", () => {
    expect(normalizeSite("github.com")).toBe("github.com");
    expect(normalizeSite("  HTTPS://GitHub.com/login?x=1 ")).toBe("github.com");
    expect(normalizeSite("mail.google.com/")).toBe("mail.google.com");
  });
  it("refuses what is not a site", () => {
    expect(normalizeSite("")).toBeNull();
    expect(normalizeSite("github")).toBeNull();
    expect(normalizeSite("not a site")).toBeNull();
  });
});

describe("tryTakeoverTask", () => {
  it("names the site and the loop in one message", () => {
    const t = tryTakeoverTask("github.com");
    expect(t).toMatch(/^Let's try a takeover on github\.com\./);
    expect(t).toMatch(/requestTakeover/);
    expect(t).toMatch(/Never type credentials/);
  });
});
