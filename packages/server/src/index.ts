import { createHash, createHmac } from "node:crypto";

const sdkVersion = "0.5.0";
const defaultEndpoint = "https://launchbuddy.points-playground.com/api/v1/server/events";
const serverKeyPattern = /^lb_secret_[A-Za-z0-9_-]{43}$/;

export type SignupInput = {
  userId: string;
  source?: SignupSource;
  idempotencyKey?: string;
  occurredAt?: Date;
  anonymousId?: string;
  sessionId?: string;
};

export type SignupSource = "better-auth" | "clerk" | "custom";
export type InstallationSource = SignupSource | "stripe";

type ServerInstallationEvent = {
  version: 1;
  eventId: string;
  type: "installation";
  occurredAt: string;
  source: InstallationSource;
  sdk: {
    name: "@launch-buddy/server";
    version: string;
  };
};

type ServerSignupEvent = {
  version: 1;
  eventId: string;
  type: "signup";
  occurredAt: string;
  source: SignupSource;
  subjectId: string;
  anonymousId?: string;
  sessionId?: string;
  sdk: {
    name: "@launch-buddy/server";
    version: string;
  };
};

type ServerPaymentEvent = {
  version: 1;
  eventId: string;
  type: "payment";
  occurredAt: string;
  source: "stripe";
  providerEventId: string;
  transactionId: string;
  customerId: string;
  amount: number;
  currency: string;
  sdk: {
    name: "@launch-buddy/server";
    version: string;
  };
};

export type JourneyIdentifiers = Pick<SignupInput, "anonymousId" | "sessionId">;

export type DeliveryResult =
  | { status: "sent"; eventId: string; duplicate: boolean; newCustomer?: boolean }
  | {
      status: "failed";
      reason: "invalid_input" | "network_error" | "http_rejected";
      statusCode?: number;
    };

export type LaunchBuddyServerClient = {
  verifyInstallation(input: { source: InstallationSource }): Promise<DeliveryResult>;
  signup(input: SignupInput): Promise<DeliveryResult>;
  payment(input: PaymentInput): Promise<DeliveryResult>;
};

export type PaymentInput = {
  customerId: string;
  providerEventId: string;
  transactionId: string;
  amount: number;
  currency: string;
  occurredAt?: Date;
};

type Fetch = typeof globalThis.fetch;

export type LaunchBuddyServerOptions = {
  serverKey: string;
  endpoint?: string;
  fetch?: Fetch;
};

function deterministicUuid(value: string) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function opaqueSubjectId(serverKey: string, source: SignupSource, userId: string) {
  const digest = createHmac("sha256", serverKey)
    .update(`${source}\0${userId}`)
    .digest("base64url");
  return `usr_${digest}`;
}

function opaqueId(serverKey: string, prefix: "cus" | "evt" | "txn", value: string) {
  const digest = createHmac("sha256", serverKey)
    .update(`${prefix}\0${value}`)
    .digest("base64url");
  return `${prefix}_${digest}`;
}

function validIdentifier(value: string | undefined) {
  return value === undefined || (value.length > 0 && value.length <= 128);
}

// The hosted SDK generates lowercase RFC 4122 version 4 UUIDs.
const anonymousIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function browserAnonymousId(value: unknown): string | undefined {
  return typeof value === "string" && anonymousIdPattern.test(value) ? value : undefined;
}

export function anonymousIdFrom(
  input: Request | Headers | string | null | undefined,
): string | undefined {
  const cookie = typeof input === "string" ? input
    : input && "headers" in input ? input.headers.get("cookie")
    : input?.get("cookie");
  const values = (cookie ?? "").split(";").map((part) => part.trim())
    .filter((part) => part.startsWith("lb_aid="));
  // Ambiguous cookie paths/domains must not choose an identity arbitrarily.
  if (values.length !== 1) return undefined;
  return browserAnonymousId(values[0]!.slice("lb_aid=".length));
}

function betterAuthAnonymousId(context: unknown): string | undefined {
  if (!context || typeof context !== "object") return undefined;
  const ctx = context as { request?: Request; headers?: HeadersInit };
  try {
    return anonymousIdFrom(ctx.request ?? (ctx.headers ? new Headers(ctx.headers) : undefined));
  } catch {
    // A missing or malformed analytics hint must not drop the signup itself.
    return undefined;
  }
}

export function createLaunchBuddyServer(
  options: LaunchBuddyServerOptions,
): LaunchBuddyServerClient {
  if (!serverKeyPattern.test(options.serverKey)) {
    throw new Error("Launch Buddy server key has an invalid format");
  }

  const endpoint = new URL(options.endpoint ?? defaultEndpoint).toString();
  const request = options.fetch ?? globalThis.fetch;

  async function deliver(
    event: ServerInstallationEvent | ServerSignupEvent | ServerPaymentEvent,
  ): Promise<DeliveryResult> {
    try {
      const response = await request(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.serverKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        return {
          status: "failed",
          reason: "http_rejected",
          statusCode: response.status,
        };
      }

      let duplicate = false;
      let newCustomer: boolean | undefined;
      try {
        const body = (await response.json()) as {
          duplicate?: unknown;
          newCustomer?: unknown;
        };
        duplicate = body.duplicate === true;
        if (typeof body.newCustomer === "boolean") newCustomer = body.newCustomer;
      } catch {
        // A successful ingestion response is authoritative even without JSON.
      }
      return {
        status: "sent",
        eventId: event.eventId,
        duplicate,
        ...(newCustomer === undefined ? {} : { newCustomer }),
      };
    } catch {
      return { status: "failed", reason: "network_error" };
    }
  }

  return {
    async verifyInstallation(input) {
      const event: ServerInstallationEvent = {
        version: 1,
        eventId: deterministicUuid(`installation\0${input.source}`),
        type: "installation",
        occurredAt: new Date().toISOString(),
        source: input.source,
        sdk: { name: "@launch-buddy/server", version: sdkVersion },
      };
      return deliver(event);
    },

    async signup(input) {
      const source = input.source ?? "custom";
      const userId = input.userId.trim();
      if (
        !userId ||
        userId.length > 256 ||
        !validIdentifier(input.anonymousId) ||
        !validIdentifier(input.sessionId)
      ) {
        return { status: "failed", reason: "invalid_input" };
      }

      const stableKey = input.idempotencyKey?.trim() || `${source}:${userId}`;
      if (stableKey.length > 512) {
        return { status: "failed", reason: "invalid_input" };
      }

      const event: ServerSignupEvent = {
        version: 1,
        eventId: deterministicUuid(`${source}\0${stableKey}`),
        type: "signup",
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        source,
        subjectId: opaqueSubjectId(options.serverKey, source, userId),
        ...(input.anonymousId ? { anonymousId: input.anonymousId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        sdk: { name: "@launch-buddy/server", version: sdkVersion },
      };

      return deliver(event);
    },

    async payment(input) {
      const customerId = input.customerId.trim();
      const providerEventId = input.providerEventId.trim();
      const transactionId = input.transactionId.trim();
      const currency = input.currency.trim().toUpperCase();
      if (
        !customerId || customerId.length > 256 ||
        !providerEventId || providerEventId.length > 256 ||
        !transactionId || transactionId.length > 256 ||
        !Number.isSafeInteger(input.amount) || input.amount <= 0 ||
        !/^[A-Z]{3}$/.test(currency)
      ) {
        return { status: "failed", reason: "invalid_input" };
      }

      const event: ServerPaymentEvent = {
        version: 1,
        eventId: deterministicUuid(`stripe\0${providerEventId}`),
        type: "payment",
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        source: "stripe",
        providerEventId: opaqueId(options.serverKey, "evt", providerEventId),
        transactionId: opaqueId(options.serverKey, "txn", transactionId),
        customerId: opaqueId(options.serverKey, "cus", customerId),
        amount: input.amount,
        currency,
        sdk: { name: "@launch-buddy/server", version: sdkVersion },
      };
      return deliver(event);
    },
  };
}

export function createBetterAuthSignupAfterHook(
  client: LaunchBuddyServerClient,
  options: {
    getJourneyIdentifiers?: (
      user: { id: string },
      context: unknown,
    ) => JourneyIdentifiers | Promise<JourneyIdentifiers>;
  } = {},
) {
  return async function launchBuddyAfterUserCreate(
    user: { id: string },
    context?: unknown,
  ): Promise<void> {
    try {
      const journey = options.getJourneyIdentifiers
        ? await options.getJourneyIdentifiers(user, context)
        : {};
      const anonymousId = journey.anonymousId ?? betterAuthAnonymousId(context);
      await client.signup({
        userId: user.id,
        source: "better-auth",
        idempotencyKey: user.id,
        ...journey,
        ...(anonymousId ? { anonymousId } : {}),
      });
    } catch {
      // Analytics must never reject or alter the Better Auth transaction.
    }
  };
}

export type VerifiedClerkWebhook = {
  type: string;
  data?: { id?: unknown; unsafe_metadata?: unknown; unsafeMetadata?: unknown };
};

export async function trackVerifiedClerkWebhook(
  client: LaunchBuddyServerClient,
  input: {
    event: VerifiedClerkWebhook;
    webhookId: string;
    journey?: JourneyIdentifiers;
  },
): Promise<DeliveryResult | { status: "ignored" }> {
  if (input.event.type !== "user.created") return { status: "ignored" };
  if (typeof input.event.data?.id !== "string" || !input.event.data.id) {
    return { status: "failed", reason: "invalid_input" };
  }

  // Clerk's signed webhook JSON uses snake_case; accept mapped SDK objects too.
  const metadata = input.event.data.unsafe_metadata ?? input.event.data.unsafeMetadata;
  const anonymousId = metadata && typeof metadata === "object"
    ? browserAnonymousId((metadata as Record<string, unknown>).launchBuddyAnonymousId)
    : undefined;
  return client.signup({
    userId: input.event.data.id,
    source: "clerk",
    idempotencyKey: input.webhookId,
    ...(anonymousId ? { anonymousId } : {}),
    ...input.journey,
  });
}

type StripeObject = Record<string, unknown>;

export type VerifiedStripeEvent = {
  id?: unknown;
  type?: unknown;
  created?: unknown;
  data?: { object?: unknown };
};

function stripeObject(value: unknown): StripeObject | null {
  return value && typeof value === "object" ? value as StripeObject : null;
}

function stripeString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stripeAmount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export async function trackVerifiedStripeEvent(
  client: LaunchBuddyServerClient,
  input: { event: VerifiedStripeEvent },
): Promise<DeliveryResult | { status: "ignored" }> {
  const eventId = stripeString(input.event.id);
  const object = stripeObject(input.event.data?.object);
  if (!eventId || !object) return { status: "failed", reason: "invalid_input" };

  let customerId: string | null = null;
  let transactionId: string | null = null;
  let amount: number | null = null;
  let currency: string | null = null;

  if (input.event.type === "invoice.paid") {
    customerId = stripeString(object.customer);
    transactionId = stripeString(object.id);
    amount = stripeAmount(object.amount_paid);
    currency = stripeString(object.currency)?.toUpperCase() ?? null;
  } else if (
    input.event.type === "checkout.session.completed" &&
    object.mode === "payment" &&
    object.payment_status === "paid" &&
    !object.invoice
  ) {
    customerId = stripeString(object.customer);
    transactionId = stripeString(object.payment_intent) ?? stripeString(object.id);
    amount = stripeAmount(object.amount_total);
    currency = stripeString(object.currency)?.toUpperCase() ?? null;
  } else {
    return { status: "ignored" };
  }

  if (!customerId || !transactionId || !amount || !currency) {
    return { status: "failed", reason: "invalid_input" };
  }

  const created = input.event.created;
  const occurredAt = typeof created === "number" && Number.isFinite(created)
    ? new Date(created * 1000)
    : undefined;
  return client.payment({
    customerId,
    providerEventId: eventId,
    transactionId,
    amount,
    currency,
    ...(occurredAt ? { occurredAt } : {}),
  });
}
