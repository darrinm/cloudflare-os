import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePushSubscription, pushConfigured, sendPush } from "../src/push.js";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A fresh VAPID pair and a fresh browser-side key pair, in the base64url shapes the wire uses. */
async function keys() {
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const vapidPublic = b64url(await crypto.subtle.exportKey("raw", vapid.publicKey));
  const vapidJwk = await crypto.subtle.exportKey("jwk", vapid.privateKey);
  const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const p256dh = b64url(await crypto.subtle.exportKey("raw", client.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return { vapidPublic, vapidPrivate: vapidJwk.d!, p256dh, auth };
}

describe("push", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is disabled unless all three VAPID settings are present", () => {
    expect(pushConfigured({})).toBe(false);
    expect(pushConfigured({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" })).toBe(false);
    expect(pushConfigured({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b", VAPID_SUBJECT: "mailto:x@y" })).toBe(true);
  });

  it("validates browser subscriptions", async () => {
    const k = await keys();
    const good = { endpoint: "https://push.example/abc", expirationTime: null, keys: { auth: k.auth, p256dh: k.p256dh } };
    expect(parsePushSubscription(good)).toEqual(good);
    expect(() => parsePushSubscription(null)).toThrow(/object/);
    expect(() => parsePushSubscription({ ...good, endpoint: "http://push.example/abc" })).toThrow(/https/);
    expect(() => parsePushSubscription({ ...good, keys: { auth: "short", p256dh: k.p256dh } })).toThrow(/keys/);
  });

  it("encrypts and posts to the endpoint with VAPID, mapping 410 to gone", async () => {
    const k = await keys();
    const env = { VAPID_PUBLIC_KEY: k.vapidPublic, VAPID_PRIVATE_KEY: k.vapidPrivate, VAPID_SUBJECT: "mailto:ops@example.com" };
    const subscription = {
      endpoint: "https://push.example/sub/1", expirationTime: null,
      keys: { auth: k.auth, p256dh: k.p256dh }, created: new Date(),
    };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 201;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status }); });

    const notification = { title: "Bot: Helper", body: "Done", url: "/bots", tag: "chat-7" };
    await expect(sendPush(env, subscription, notification)).resolves.toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(subscription.endpoint);
    const headers = calls[0].init.headers as Record<string, string>;
    // The library speaks the aesgcm form of RFC 8291 (salt in Encryption, sender key in Crypto-Key).
    expect(headers["content-encoding"]).toBe("aesgcm");
    expect(headers.encryption).toMatch(/^salt=/);
    expect(headers["crypto-key"]).toMatch(/dh=/);
    expect(headers.authorization).toMatch(/^(vapid t=|WebPush )/);
    expect(headers.topic).toBe("chat-7");
    expect((calls[0].init.body as Uint8Array).byteLength).toBeGreaterThan(80);
    // Ciphertext, not the plaintext title.
    expect(new TextDecoder().decode(calls[0].init.body as Uint8Array)).not.toContain("Bot: Helper");

    status = 410;
    await expect(sendPush(env, subscription, notification)).resolves.toBe("gone");
    status = 500;
    await expect(sendPush(env, subscription, notification)).resolves.toBe("failed");
    await expect(sendPush({}, subscription, notification)).resolves.toBe("disabled");
  });
});
