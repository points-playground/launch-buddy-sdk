import { describe, expect, it, vi } from "vitest";

import {
  anonymousIdFrom,
  createBetterAuthSignupAfterHook,
  createLaunchBuddyServer,
  trackVerifiedClerkWebhook,
  trackVerifiedStripeEvent,
} from "../src/index";

const serverKey = `lb_secret_${"a".repeat(43)}`;

function accepted(body: object = { accepted: true, duplicate: false }) {
  return new Response(JSON.stringify(body), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Launch Buddy server client", () => {
  it("sends an idempotent, non-counting installation handshake", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return accepted();
    });
    const client = createLaunchBuddyServer({ serverKey, fetch: request });

    await client.verifyInstallation({ source: "better-auth" });
    await client.verifyInstallation({ source: "better-auth" });

    expect(payloads[0]).toMatchObject({
      type: "installation",
      source: "better-auth",
      sdk: { name: "@launch-buddy/server", version: "0.5.0" },
    });
    expect(payloads[0]?.eventId).toBe(payloads[1]?.eventId);
    expect(JSON.stringify(payloads[0])).not.toContain("user");
  });

  it("sends only a canonical sanitized signup event", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(accepted());
    const client = createLaunchBuddyServer({ serverKey, fetch: request });

    await expect(client.signup({
      userId: "clerk-user-123",
      source: "clerk",
      idempotencyKey: "webhook-123",
      anonymousId: "anon-123",
    })).resolves.toMatchObject({ status: "sent" });

    const [, init] = request.mock.calls[0]!;
    const event = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(event).toMatchObject({
      version: 1,
      type: "signup",
      source: "clerk",
      anonymousId: "anon-123",
      sdk: { name: "@launch-buddy/server", version: "0.5.0" },
    });
    expect(event.subjectId).toMatch(/^usr_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(event)).not.toContain("clerk-user-123");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${serverKey}` });
  });

  it("shares default and explicit signup event identities across surface keys", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return accepted();
    });
    const web = createLaunchBuddyServer({ serverKey, fetch: request });
    const ios = createLaunchBuddyServer({ serverKey: `lb_secret_${"b".repeat(43)}`, fetch: request });
    for (const input of [{ userId: "same-user" }, { userId: "same-user", idempotencyKey: "same-key" }]) {
      await web.signup(input);
      await ios.signup(input);
    }
    expect(payloads[0]!.eventId).toBe(payloads[1]!.eventId);
    expect(payloads[2]!.eventId).toBe(payloads[3]!.eventId);
    expect(payloads[0]!.subjectId).not.toBe(payloads[1]!.subjectId);
    await ios.signup({ userId: "same-user", idempotencyKey: "different-key" });
    expect(payloads[4]!.eventId).not.toBe(payloads[3]!.eventId);
  });

  it("derives stable event and subject IDs for safe retries", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return accepted();
    });
    const client = createLaunchBuddyServer({ serverKey, fetch: request });

    await client.signup({ userId: "user-1", source: "custom", idempotencyKey: "signup-1" });
    await client.signup({ userId: "user-1", source: "custom", idempotencyKey: "signup-1" });

    expect(payloads[0]?.eventId).toBe(payloads[1]?.eventId);
    expect(payloads[0]?.subjectId).toBe(payloads[1]?.subjectId);
  });

  it("turns network and HTTP failures into values instead of exceptions", async () => {
    const networkClient = createLaunchBuddyServer({
      serverKey,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    });
    const rejectedClient = createLaunchBuddyServer({
      serverKey,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    });

    await expect(networkClient.signup({ userId: "user-1" })).resolves.toEqual({
      status: "failed",
      reason: "network_error",
    });
    await expect(rejectedClient.signup({ userId: "user-1" })).resolves.toEqual({
      status: "failed",
      reason: "http_rejected",
      statusCode: 401,
    });
  });

  it("sends only opaque Stripe identifiers and returns first-customer status", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      accepted({ accepted: true, duplicate: false, newCustomer: true }),
    );
    const client = createLaunchBuddyServer({ serverKey, fetch: request });

    await expect(client.payment({
      customerId: "cus_private",
      providerEventId: "evt_private",
      transactionId: "in_private",
      amount: 2900,
      currency: "usd",
    })).resolves.toMatchObject({ status: "sent", newCustomer: true });

    const [, init] = request.mock.calls[0]!;
    const event = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(event).toMatchObject({
      type: "payment",
      source: "stripe",
      amount: 2900,
      currency: "USD",
    });
    expect(JSON.stringify(event)).not.toContain("private");
  });
});

describe("provider adapters", () => {
  it("never lets Better Auth tracking failures reject user creation", async () => {
    const signup = vi.fn().mockRejectedValue(new Error("unexpected adapter failure"));
    const after = createBetterAuthSignupAfterHook({
      verifyInstallation: vi.fn(),
      signup,
      payment: vi.fn(),
    });

    await expect(after({ id: "better-auth-user" })).resolves.toBeUndefined();
    expect(signup).toHaveBeenCalledWith({
      userId: "better-auth-user",
      source: "better-auth",
      idempotencyKey: "better-auth-user",
    });
  });

  it("normalizes only verified Clerk user-created events", async () => {
    const signup = vi.fn().mockResolvedValue({ status: "sent", eventId: "event", duplicate: false });
    const client = { verifyInstallation: vi.fn(), signup, payment: vi.fn() };

    await expect(trackVerifiedClerkWebhook(client, {
      event: { type: "session.created", data: { id: "session" } },
      webhookId: "wh-ignored",
    })).resolves.toEqual({ status: "ignored" });

    await trackVerifiedClerkWebhook(client, {
      event: { type: "user.created", data: { id: "clerk-user", email: "private@example.com" } } as never,
      webhookId: "wh-created",
    });
    expect(signup).toHaveBeenCalledTimes(1);
    expect(signup).toHaveBeenCalledWith({
      userId: "clerk-user",
      source: "clerk",
      idempotencyKey: "wh-created",
    });
  });

  it("normalizes verified Stripe invoice payments without forwarding PII", async () => {
    const payment = vi.fn().mockResolvedValue({
      status: "sent",
      eventId: "event",
      duplicate: false,
      newCustomer: true,
    });
    const client = { verifyInstallation: vi.fn(), signup: vi.fn(), payment };

    await expect(trackVerifiedStripeEvent(client, {
      event: {
        id: "evt_1",
        type: "customer.subscription.updated",
        data: { object: {} },
      },
    })).resolves.toEqual({ status: "ignored" });

    await trackVerifiedStripeEvent(client, {
      event: {
        id: "evt_paid",
        type: "invoice.paid",
        created: 1_800_000_000,
        data: {
          object: {
            id: "in_1",
            customer: "cus_1",
            amount_paid: 2900,
            currency: "usd",
            customer_email: "private@example.com",
          },
        },
      },
    });
    expect(payment).toHaveBeenCalledWith({
      customerId: "cus_1",
      providerEventId: "evt_paid",
      transactionId: "in_1",
      amount: 2900,
      currency: "USD",
      occurredAt: new Date(1_800_000_000_000),
    });
  });

  it("accepts paid one-time Checkout and ignores subscription Checkout", async () => {
    const payment = vi.fn().mockResolvedValue({ status: "sent" });
    const client = { verifyInstallation: vi.fn(), signup: vi.fn(), payment };
    const base = {
      id: "evt_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          customer: "cus_1",
          payment_intent: "pi_1",
          amount_total: 5000,
          currency: "usd",
          payment_status: "paid",
        },
      },
    };

    await expect(trackVerifiedStripeEvent(client, {
      event: { ...base, data: { object: { ...base.data.object, mode: "subscription" } } },
    })).resolves.toEqual({ status: "ignored" });
    await trackVerifiedStripeEvent(client, {
      event: { ...base, data: { object: { ...base.data.object, mode: "payment" } } },
    });
    expect(payment).toHaveBeenCalledTimes(1);
  });
});

const aid = "00000000-0000-4000-8000-000000000001";
describe("identity bridge", () => {
  it("reads only an unambiguous SDK UUID from cookies, headers and requests", () => {
    const cookie = `other=x; lb_aid=${aid}; last=y`;
    expect(anonymousIdFrom(cookie)).toBe(aid);
    expect(anonymousIdFrom(new Headers({ cookie }))).toBe(aid);
    expect(anonymousIdFrom(new Request("https://example.com", { headers: { cookie } }))).toBe(aid);
    for (const value of [undefined, null, "", "other=x", "lb_aid=", "lb_aid=anon-123",
      `lb_aid=${aid}x`, `lb_aid=${aid.replace("000000000001", "ABCDEFABCDEF")}`,
      `lb_aid=${aid.replace("4000", "5000")}`, `lb_aid=${aid}; lb_aid=${aid}`,
      `lb_aid=%30${aid.slice(1)}`, "lb_aid=private@example.com"]) {
      expect(anonymousIdFrom(value)).toBeUndefined();
    }
  });
  it("automatically forwards Better Auth request and header cookies", async () => {
    const signup = vi.fn().mockResolvedValue({ status: "sent" });
    const client = { signup, payment: vi.fn(), verifyInstallation: vi.fn() };
    const hook = createBetterAuthSignupAfterHook(client);
    await hook({ id: "user" }, { request: new Request("https://example.com", { headers: { cookie: `lb_aid=${aid}` } }) });
    await hook({ id: "user" }, { headers: new Headers({ cookie: `lb_aid=${aid}` }) });
    expect(signup.mock.calls.map(([input]) => input.anonymousId)).toEqual([aid, aid]);
    for (const headers of [{ cookie: `lb_aid=${aid}` }, [["cookie", `lb_aid=${aid}`]]]) {
      await hook({ id: "user" }, { headers });
      expect(signup.mock.lastCall?.[0]).toMatchObject({ anonymousId: aid });
    }
    await hook({ id: "user" }, { headers: { "invalid header": "x" } });
    expect(signup.mock.lastCall?.[0]).toMatchObject({ userId: "user" });
    expect(signup.mock.lastCall?.[0]).not.toHaveProperty("anonymousId");
    signup.mockClear();
    await hook({ id: "user" }, null);
    expect(signup.mock.calls[0]![0]).not.toHaveProperty("anonymousId");
    await createBetterAuthSignupAfterHook(client, { getJourneyIdentifiers: () => ({ anonymousId: "legacy-id", sessionId: "session" }) })
      ({ id: "user" }, { headers: new Headers({ cookie: `lb_aid=${aid}` }) });
    expect(signup.mock.calls[1]![0]).toMatchObject({ anonymousId: "legacy-id", sessionId: "session" });
  });
  it("reads Clerk metadata while omitting invalid values and raw fields", async () => {
    const signup = vi.fn().mockResolvedValue({ status: "sent" });
    const client = { signup, payment: vi.fn(), verifyInstallation: vi.fn() };
    for (const field of ["unsafe_metadata", "unsafeMetadata"]) {
      await trackVerifiedClerkWebhook(client, { webhookId: "wh", event: { type: "user.created",
        data: { id: "user", [field]: { launchBuddyAnonymousId: aid, email: "private@example.com" } } } });
      expect(signup.mock.lastCall?.[0]).toEqual({ userId: "user", source: "clerk", idempotencyKey: "wh", anonymousId: aid });
    }
    for (const metadata of [null, "bad", {}, { launchBuddyAnonymousId: "private@example.com" }, { launchBuddyAnonymousId: 42 }]) {
      await trackVerifiedClerkWebhook(client, { webhookId: "wh", event: { type: "user.created", data: { id: "user", unsafe_metadata: metadata } } });
      expect(signup.mock.lastCall?.[0]).not.toHaveProperty("anonymousId");
    }
  });
});
