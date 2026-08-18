import { describe, expect, it, vi } from "vitest";
import { accessRateLimitKey, resolveAccessIdentity, verifyCfAccessJwt } from "../src/access.js";

const joseMocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn().mockResolvedValue({ payload: { sub: "user-1" } }),
}));

vi.mock("jose", () => joseMocks);

const accessEnv = {
  CF_ACCESS_AUD: "workshop-audience",
  CF_ACCESS_ISS: "https://team.cloudflareaccess.com",
};

describe("verifyCfAccessJwt", () => {
  it("reuses the remote JWK set for requests with the same issuer", async () => {
    const request = new Request("https://workshop.example/api", {
      headers: { "cf-access-jwt-assertion": "signed-token" },
    });
    const otherEnv = {
      ...accessEnv,
      CF_ACCESS_ISS: "https://other-team.cloudflareaccess.com",
    };

    await verifyCfAccessJwt(request, accessEnv);
    await verifyCfAccessJwt(request, accessEnv);
    await verifyCfAccessJwt(request, otherEnv);

    expect(joseMocks.createRemoteJWKSet).toHaveBeenCalledTimes(2);
    expect(joseMocks.createRemoteJWKSet).toHaveBeenNthCalledWith(
      1, new URL("https://team.cloudflareaccess.com/cdn-cgi/access/certs"),
    );
    expect(joseMocks.createRemoteJWKSet).toHaveBeenNthCalledWith(
      2, new URL("https://other-team.cloudflareaccess.com/cdn-cgi/access/certs"),
    );
  });

  it("rejects missing and invalid assertions", async () => {
    const requestWithoutToken = new Request("https://workshop.example/api/client-errors");
    const verifier = vi.fn();
    const missing = await verifyCfAccessJwt(requestWithoutToken, accessEnv, verifier);
    expect(missing).toBeNull();
    expect(verifier).not.toHaveBeenCalled();

    const requestWithToken = new Request("https://workshop.example/api/client-errors", {
      headers: { "cf-access-jwt-assertion": "invalid" },
    });
    verifier.mockRejectedValue(new Error("invalid signature"));
    const invalid = await verifyCfAccessJwt(requestWithToken, accessEnv, verifier);
    expect(invalid).toBeNull();
  });

  it("returns claims only after verification", async () => {
    const request = new Request("https://workshop.example/api", {
      headers: { "cf-access-jwt-assertion": "signed-token" },
    });
    const verifier = vi.fn().mockResolvedValue({
      sub: "user-1", email: "person@example.com",
    });

    await expect(verifyCfAccessJwt(request, accessEnv, verifier)).resolves.toEqual({
      sub: "user-1", email: "person@example.com",
    });
  });
});

describe("accessRateLimitKey", () => {
  it("uses the verified subject and hashes email only as a fallback", async () => {
    await expect(accessRateLimitKey({ sub: "user-1", email: "person@example.com" }))
      .resolves.toBe("access-sub:user-1");
    const emailKey = await accessRateLimitKey({ email: "person@example.com" });
    expect(emailKey).toMatch(/^access-email:[0-9a-f]{64}$/);
    expect(emailKey).not.toContain("person@example.com");
  });
});

describe("resolveAccessIdentity", () => {
  const automationEnv = {
    ...accessEnv,
    CF_ACCESS_AUTOMATION_CLIENT_ID: "abc123.access",
    CF_ACCESS_AUTOMATION_EMAIL: "automation@workshop.example",
  };

  it("uses the identity provider's email when present", () => {
    expect(resolveAccessIdentity({ email: "person@example.com" }, automationEnv))
      .toEqual({ email: "person@example.com", automation: false });
    // A human login is never reinterpreted as automation, even with a matching common_name.
    expect(resolveAccessIdentity(
      { email: "person@example.com", common_name: "abc123.access" }, automationEnv,
    )).toEqual({ email: "person@example.com", automation: false });
  });

  it("maps the configured service token to the automation email", () => {
    expect(resolveAccessIdentity({ common_name: "abc123.access", sub: "" }, automationEnv))
      .toEqual({ email: "automation@workshop.example", automation: true });
  });

  it("rejects service tokens that are unknown or unconfigured", () => {
    expect(resolveAccessIdentity({ common_name: "other.access" }, automationEnv)).toBeNull();
    expect(resolveAccessIdentity({ common_name: "abc123.access" }, accessEnv)).toBeNull();
    expect(resolveAccessIdentity({ common_name: "abc123.access" }, {
      ...accessEnv, CF_ACCESS_AUTOMATION_CLIENT_ID: "abc123.access",
    })).toBeNull();
    expect(resolveAccessIdentity({}, automationEnv)).toBeNull();
    expect(resolveAccessIdentity({ email: "" }, automationEnv)).toBeNull();
  });
});
