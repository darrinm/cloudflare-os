import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/** Cloudflare Access settings required to verify an assertion. */
export type CfAccessEnv = Readonly<{
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ISS?: string;
  /**
   * Optional automation identity. An Access *service token* (Service Auth policy) produces an
   * assertion whose `common_name` is the token's client id and which carries no `email`. When both
   * settings are present and `common_name` matches, the request is authenticated as this email so
   * headless clients (smoke tests, agents) can use the API without a human sign-in. Anything else
   * without an email is still rejected.
   */
  CF_ACCESS_AUTOMATION_CLIENT_ID?: string;
  CF_ACCESS_AUTOMATION_EMAIL?: string;
}>;

/** Who a verified Access assertion authenticates, and whether it came from the automation token. */
export type AccessIdentity = Readonly<{ email: string; automation: boolean }>;

/**
 * Resolves the identity behind verified Access claims: the user's email for an identity-provider
 * login, or the configured automation email for the deployment's service token. Returns null when
 * the claims identify nobody the deployment recognizes.
 */
export function resolveAccessIdentity(payload: JWTPayload, env: CfAccessEnv): AccessIdentity | null {
  if (typeof payload.email === "string" && payload.email.length > 0) {
    return { email: payload.email, automation: false };
  }
  const clientId = env.CF_ACCESS_AUTOMATION_CLIENT_ID;
  const email = env.CF_ACCESS_AUTOMATION_EMAIL;
  if (clientId && email && typeof payload.common_name === "string" &&
      payload.common_name === clientId) {
    return { email, automation: true };
  }
  return null;
}

type AccessTokenVerifier = (token: string, env: CfAccessEnv) => Promise<JWTPayload>;

const remoteJwkSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function verifyToken(token: string, env: CfAccessEnv): Promise<JWTPayload> {
  if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_ISS) {
    throw new Error("Cloudflare Access issuer and audience must both be configured.");
  }
  let jwks = remoteJwkSets.get(env.CF_ACCESS_ISS);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${env.CF_ACCESS_ISS}/cdn-cgi/access/certs`));
    remoteJwkSets.set(env.CF_ACCESS_ISS, jwks);
  }
  return (await jwtVerify(token, jwks, {
    issuer: env.CF_ACCESS_ISS,
    audience: env.CF_ACCESS_AUD,
  })).payload;
}

/** Returns verified Cloudflare Access claims, or null when the assertion cannot be trusted. */
export async function verifyCfAccessJwt(
    request: Request,
    env: CfAccessEnv,
    verifier: AccessTokenVerifier = verifyToken): Promise<JWTPayload | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  try {
    return await verifier(token, env);
  } catch {
    return null;
  }
}

/** Returns a privacy-preserving limiter key derived only from verified Access claims. */
export async function accessRateLimitKey(payload: JWTPayload): Promise<string | null> {
  if (payload.sub) return `access-sub:${payload.sub}`;
  if (typeof payload.email !== "string" || payload.email.length === 0) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload.email));
  return `access-email:${new Uint8Array(digest).toHex()}`;
}
