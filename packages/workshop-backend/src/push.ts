// Web Push (RFC 8030/8291/8292) for the Workshop: notify a user's installed browsers/PWA when a Bot
// (agent-spawner chat) finishes a turn or needs them, while they are not looking at the workspace.
//
// Deployment config: VAPID_PUBLIC_KEY (var, base64url raw P-256 point), VAPID_PRIVATE_KEY (secret,
// base64url 32-byte scalar), VAPID_SUBJECT (var, "mailto:..." or an https origin). All three absent
// = push disabled; the API reports it and the frontend hides the control.

import { buildPushPayload, type PushMessage, type PushSubscription } from "@block65/webcrypto-web-push";
import { createWorkshopLogger } from "./observability";

const logger = createWorkshopLogger("workshop.push");

/** Push settings, all optional; see the module comment. */
export type PushEnv = Readonly<{
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}>;

/** What one notification carries. `url` is same-origin (the frontend deep-links on click). */
export type PushNotification = {
  title: string;
  body: string;
  url: string;
  /** Collapses repeated notifications about the same thing (Web Push `topic`; ≤32 URL-safe chars). */
  tag?: string;
};

/** A browser's PushSubscription as stored, plus bookkeeping. */
export type StoredPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { auth: string; p256dh: string };
  created: Date;
  userAgent?: string;
};

/** True when the deployment has VAPID keys and a subject configured. */
export function pushConfigured(env: PushEnv): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/** Validates a subscription object as sent by the browser (`PushSubscription.toJSON()`). */
export function parsePushSubscription(input: unknown): Omit<StoredPushSubscription, "created" | "userAgent"> {
  const sub = input as Partial<PushSubscription> | null;
  if (!sub || typeof sub !== "object") throw new Error("Push subscription must be an object.");
  if (typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || sub.endpoint.length > 2048) {
    throw new Error("Push subscription needs an https endpoint.");
  }
  const keys = sub.keys as { auth?: unknown; p256dh?: unknown } | undefined;
  if (!keys || typeof keys.auth !== "string" || typeof keys.p256dh !== "string" ||
      !/^[A-Za-z0-9_-]{16,}$/.test(keys.auth) || !/^[A-Za-z0-9_-]{80,}$/.test(keys.p256dh)) {
    throw new Error("Push subscription needs base64url auth and p256dh keys.");
  }
  const expirationTime = typeof sub.expirationTime === "number" ? sub.expirationTime : null;
  return { endpoint: sub.endpoint, expirationTime, keys: { auth: keys.auth, p256dh: keys.p256dh } };
}

export type PushSendResult = "sent" | "gone" | "failed" | "disabled";

/**
 * Sends one notification to one subscription. "gone" means the push service says the subscription
 * no longer exists (404/410) and the caller should forget it; "failed" is transient or a config
 * problem, logged and otherwise swallowed -- notifications are best-effort.
 */
export async function sendPush(env: PushEnv, subscription: StoredPushSubscription,
                               notification: PushNotification): Promise<PushSendResult> {
  if (!pushConfigured(env)) return "disabled";
  const message: PushMessage = {
    data: notification,
    options: {
      ttl: 60 * 60 * 6,
      urgency: "normal",
      ...(notification.tag ? { topic: notification.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
    },
  };
  try {
    const payload = await buildPushPayload(message, {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime,
      keys: subscription.keys,
    }, {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
    const response = await fetch(subscription.endpoint, payload);
    if (response.status === 404 || response.status === 410) return "gone";
    if (!response.ok) {
      logger.warn("push send rejected", { event: "push.send.rejected", status: response.status });
      return "failed";
    }
    return "sent";
  } catch (err) {
    logger.warn("push send failed", { event: "push.send.failed", error: err });
    return "failed";
  }
}
