import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

import { describe, expect, it, vi } from "vitest";

const sdkSource = readFileSync(resolve(process.cwd(), "test/fixtures/v1.js"), "utf8");

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

const packageSource = ts.transpileModule(readFileSync(resolve(process.cwd(), "packages/web/src/index.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function runner(implementation: "script" | "package") {
return function runSdk(
  projectKey = "lb_public_test_1234567890",
  fetchResult: "success" | "rejected" | "network-error" = "success",
  options: { endpoint?: string; debug?: boolean; pathPrefixes?: string; cookie?: string; storedId?: string; blockedStorage?: boolean; blockedSession?: "getter" | "read" | "write"; sessionId?: string; blockedHistory?: "getter" | "method-getter" | "readonly"; blockedCookie?: boolean; protocol?: string; href?: string } = {},
) {
  const requests: Array<{ url: string; body: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const listeners = new Map<string, () => void>();
  let uuid = 0;

  const context: Record<string, unknown> = {
    URL,
    DOMException,
    Date,
    JSON,
    Math,
    Promise,
    console: { error: vi.fn(), warn: vi.fn() },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` },
    localStorage: storage(),
    sessionStorage: storage(),
    location: { href: options.href ?? "https://site.example/pricing?email=private@example.com", protocol: options.protocol ?? "https:", pathname: "/pricing", search: "?email=private@example.com" },
    navigator: { language: "en-US", userAgent: "private-device-UA" },
    fetch: vi.fn((url: string, options: { body: string; [key: string]: unknown }) => {
      const { body, ...requestOptions } = options;
      requests.push({ url, body: JSON.parse(body) as Record<string, unknown>, options: requestOptions });
      if (fetchResult === "network-error") return Promise.reject(new Error("offline"));
      return Promise.resolve({
        ok: fetchResult === "success",
        status: fetchResult === "success" ? 202 : 403,
      });
    }),
    setInterval: vi.fn(),
    setTimeout: (callback: () => void) => callback(),
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    history: {
      pushState: (_state: unknown, _unused: string, path: string) => {
        (context.location as { pathname: string }).pathname = path;
      },
      replaceState: vi.fn(),
    },
    document: {
      cookie: options.cookie ?? "",
      currentScript: {
        src: "https://launchbuddy.points-playground.com/sdk/v1.js",
        getAttribute: (name: string) => name === "data-project-key" ? projectKey : name === "data-path-prefixes" ? options.pathPrefixes ?? null : name === "data-endpoint" ? options.endpoint ?? null : null,
        hasAttribute: (name: string) => name === "data-debug" && options.debug === true,
      },
      referrer: "https://news.ycombinator.com/item?id=123",
      visibilityState: "visible",
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      getElementsByTagName: () => [],
    },
  };
  if (options.storedId) (context.localStorage as ReturnType<typeof storage>).setItem("launch_buddy_visitor_id", options.storedId);
  if (options.blockedStorage) Object.defineProperty(context, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
  if (options.blockedCookie) Object.defineProperty(context.document, "cookie", { get() { throw new DOMException("blocked", "SecurityError"); }, set() { throw new DOMException("blocked", "SecurityError"); } });
  if (options.sessionId) (context.sessionStorage as ReturnType<typeof storage>).setItem("launch_buddy_session_id", options.sessionId);
  if (options.blockedSession === "getter") Object.defineProperty(context, "sessionStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
  if (options.blockedSession === "read") (context.sessionStorage as ReturnType<typeof storage>).getItem = () => { throw new DOMException("blocked", "SecurityError"); };
  if (options.blockedSession === "write") (context.sessionStorage as ReturnType<typeof storage>).setItem = () => { throw new DOMException("blocked", "QuotaExceededError"); };
  context.window = context;

  const replaceState = (context.history as { replaceState: ReturnType<typeof vi.fn> }).replaceState;
  if (options.blockedHistory === "getter") Object.defineProperty(context, "history", { get() { throw new DOMException("blocked", "SecurityError"); } });
  if (options.blockedHistory === "method-getter") Object.defineProperty(context.history, "pushState", { get() { throw new DOMException("blocked", "SecurityError"); } });
  if (options.blockedHistory === "readonly") Object.defineProperty(context.history, "pushState", { writable: false });
  const exports: { init?: (options: unknown) => unknown } = {};
  const sandbox = { window: context, document: context.document, navigator: context.navigator, URL, Date, JSON, Math, Promise, console: context.console, exports };
  vm.runInNewContext(implementation === "script" ? sdkSource : packageSource, sandbox);
  if (implementation === "package") exports.init!({ projectKey, endpoint: options.endpoint, debug: options.debug, pathPrefixes: options.pathPrefixes === undefined ? undefined : (() => { try { return JSON.parse(options.pathPrefixes); } catch { return "invalid"; } })() });
  return { context, requests, replaceState };
};
}

describe.each(["script", "package"] as const)("%s", implementation => {
const runSdk = runner(implementation);

it("uses the custom endpoint with the same request settings and returns HTTP rejection details", async () => {
  const { requests, context } = runSdk(undefined, "rejected", { endpoint: "https://collector.example/events", debug: true });
  const sdk = context.LaunchBuddy as { heartbeat(): Promise<unknown> };
  expect(requests[0]).toMatchObject({ url: "https://collector.example/events", options: {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", keepalive: true, mode: "cors",
  } });
  expect(await sdk.heartbeat()).toEqual({ status: "failed", reason: "http_rejected", statusCode: 403 });
  expect((context.console as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledWith("[Launch Buddy] Signal rejected with status 403.");
});

describe("hosted browser SDK", () => {
  it("sends a privacy-limited page view to the SDK host", () => {
    const { requests } = runSdk();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://launchbuddy.points-playground.com/api/v1/events");
    expect(requests[0]?.body).toMatchObject({
      version: 1,
      type: "page_view",
      path: "/pricing",
      referrerOrigin: "https://news.ycombinator.com",
      locale: "en-US",
      sdk: { name: "@launch-buddy/next", version: "0.1.0" },
    });
    expect(JSON.stringify(requests[0]?.body)).not.toContain("private@example.com");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("item?id=123");
  });

  it("sends only allowlisted campaign tags and click network presence, never click IDs or UA", () => {
    const { requests, context } = runSdk(undefined, "success", { href: "https://site.example/?ref=ProductHunt&utm_source=Newsletter&utm_medium=email&utm_campaign=autumn&via=community&source=launch&email=private@example.com&token=secret&gclid=google-secret&fbclid=meta-secret&msclkid=microsoft-secret&twclid=x-secret" });
    expect(requests[0]?.body.campaign).toEqual({ ref: "producthunt", utm_source: "newsletter", utm_medium: "email", utm_campaign: "autumn", via: "community", source: "launch" });
    expect(requests[0]?.body.adClicks).toEqual(["google", "meta", "microsoft", "x"]);
    const payload = JSON.stringify(requests[0]?.body);
    for (const forbidden of ["private@example.com", "secret", "gclid", "fbclid", "msclkid", "twclid", "userAgent", "private-device-UA", "token"]) expect(payload).not.toContain(forbidden);
    (context.LaunchBuddy as { heartbeat: () => void }).heartbeat();
    expect(requests[1]?.body).not.toHaveProperty("campaign");
    expect(requests[1]?.body).not.toHaveProperty("adClicks");
  });

  it("drops unsafe and overlong campaign values before transport", () => {
    const { requests } = runSdk(undefined, "success", { href: `https://site.example/?utm_source=private%40example.com&ref=%3Cscript%3E&via=${"a".repeat(65)}&source=abc123456&utm_medium=hello%0Aworld` });
    expect(requests[0]?.body).not.toHaveProperty("campaign");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("private");
  });

  it("tracks SPA navigation once the pathname changes", () => {
    const { context, requests } = runSdk();

    (context.history as { pushState: (...args: unknown[]) => void }).pushState({}, "", "/welcome");

    expect(requests).toHaveLength(2);
    expect(requests[1]?.body).toMatchObject({ type: "page_view", path: "/welcome" });
  });

  it("does not initialize with an invalid publishable key", () => {
    const { context, requests } = runSdk("not-a-key");

    expect(requests).toHaveLength(0);
    expect((context.console as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalledOnce();
  });

  it("distinguishes duplicate paths from delivery failures", async () => {
    const successful = runSdk();
    const launchBuddy = successful.context.LaunchBuddy as {
      pageView: () => Promise<{ status: string; reason?: string }>;
    };
    await expect(launchBuddy.pageView()).resolves.toMatchObject({
      status: "skipped",
      reason: "duplicate_path",
    });

    const failed = runSdk("lb_public_test_1234567890", "network-error");
    const failedLaunchBuddy = failed.context.LaunchBuddy as {
      heartbeat: () => Promise<{ status: string; reason?: string }>;
    };
    await expect(failedLaunchBuddy.heartbeat()).resolves.toMatchObject({
      status: "failed",
      reason: "network_error",
    });
  });
});

describe("hosted SDK identity bridge", () => {
  const aid = "12345678-1234-4123-8123-123456789abc";
  it("mirrors the existing local identity and exposes both API names", () => {
    const { context, requests } = runSdk(undefined, undefined, { storedId: aid });
    expect((context.document as { cookie: string }).cookie).toBe(`lb_aid=${aid}; Path=/; SameSite=Lax; Max-Age=31536000; Secure`);
    expect((context.launchBuddy as { anonymousId(): string }).anonymousId()).toBe(aid);
    expect(context.launchBuddy).toBe(context.LaunchBuddy);
    expect(requests[0]?.body.anonymousId).toBe(aid);
  });
  it("restores a cookie when localStorage is missing or inaccessible", () => {
    for (const blockedStorage of [false, true]) {
      const { requests } = runSdk(undefined, undefined, { cookie: `other=x; lb_aid=${aid}`, blockedStorage });
      expect(requests[0]?.body.anonymousId).toBe(aid);
    }
  });
  it("prefers existing localStorage, rejects malformed cookies and works without cookies", () => {
    expect(runSdk(undefined, undefined, { storedId: aid, cookie: "lb_aid=bad" }).requests[0]?.body.anonymousId).toBe(aid);
    for (const cookie of ["lb_aid=bad", `lb_aid=${aid}junk`, "lb_aid=private@example.com"]) {
      expect(runSdk(undefined, undefined, { cookie }).requests[0]?.body.anonymousId).not.toBe(cookie.slice(7));
    }
    expect(runSdk(undefined, undefined, { blockedCookie: true, blockedStorage: true }).requests).toHaveLength(1);
  });
  it("omits Secure on HTTP and does not write a cookie before valid initialization", () => {
    expect((runSdk(undefined, undefined, { protocol: "http:" }).context.document as { cookie: string }).cookie).not.toContain("Secure");
    expect((runSdk("bad-key").context.document as { cookie: string }).cookie).toBe("");
  });
});

it("keeps a setup visit out of production through client navigation without persisting the nonce", () => {
  const token = `${(Math.floor(Date.now()/1000)+600).toString(36)}.${"A".repeat(22)}.${"B".repeat(22)}`;
  const { context, requests, replaceState } = runSdk(undefined, "success", { href: `https://site.example/pricing?keep=yes&lb_check=${token}#plans` });
  expect(requests[0]?.body).toMatchObject({ checkToken: token, path: "/pricing" });
  expect(replaceState).toHaveBeenCalledWith(undefined, "", "/pricing?keep=yes#plans");
  (context.location as { pathname: string }).pathname = "/next";
  (context.launchBuddy as { pageView: () => void }).pageView();
  expect(requests[1]?.body).toMatchObject({ checkToken: token, path: "/next" });
  (context.launchBuddy as { heartbeat: () => void }).heartbeat();
  expect(requests).toHaveLength(3);
  expect(requests[2]?.body).toMatchObject({ type: "heartbeat", checkToken: token });
  expect((context.localStorage as ReturnType<typeof storage>).getItem("lb_check")).toBeNull();
  expect((context.sessionStorage as ReturnType<typeof storage>).getItem("lb_check")).toBeNull();
});
it.each(["short", "A".repeat(23), "!".repeat(22), "A".repeat(22) + "&lb_check=" + "B".repeat(22)])("does not send an invalid or repeated setup nonce: %s", (token) => {
  const { requests } = runSdk(undefined, "success", { href: `https://site.example/pricing?lb_check=${token}` });
  expect(requests[0]?.body).not.toHaveProperty("checkToken");
});

it("a shared link after expiry is an ordinary visit", () => {
  const token = `${(Math.floor(Date.now()/1000)-1).toString(36)}.${"A".repeat(22)}.${"B".repeat(22)}`;
  expect(runSdk(undefined,"success",{href:`https://site.example/?lb_check=${token}`}).requests[0]?.body).not.toHaveProperty("checkToken");
});

it("keeps a valid server nonce when the visitor clock is five minutes behind", () => {
  const token = `${(Math.floor(Date.now()/1000)+900).toString(36)}.${"A".repeat(22)}.${"B".repeat(22)}`;
  expect(runSdk(undefined,"success",{href:`https://site.example/?lb_check=${token}`}).requests[0]?.body.checkToken).toBe(token);
});

describe("SDK path allowlist", () => {
  it("preserves event payloads, identity, and navigation without the optional attribute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    try {
      const { context, requests } = runSdk();
      const history = context.history as { pushState: (state: unknown, unused: string, path: string) => void };
      const sdk = context.LaunchBuddy as { heartbeat: () => Promise<unknown>; anonymousId: () => string; pageView: () => Promise<unknown> };
      history.pushState(null, "", "/apps/private/home");
      await sdk.heartbeat();
      history.pushState(null, "", "/settings");
      expect(await sdk.pageView()).toEqual({ status: "skipped", reason: "duplicate_path" });
      expect({ requests, anonymousId: sdk.anonymousId(), cookie: (context.document as { cookie: string }).cookie }).toMatchSnapshot();
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses page views and heartbeats on private SPA routes, then resumes on public routes", async () => {
    const { context, requests } = runSdk(undefined, undefined, { pathPrefixes: '["/pricing","/demo"]' });
    const history = context.history as { pushState: (state: unknown, unused: string, path: string) => void };
    const sdk = context.LaunchBuddy as { heartbeat: () => Promise<unknown> };
    expect(requests).toHaveLength(1);
    for (const path of ["/apps/private/home", "/settings", "/welcome", "/demo-other"]) {
      history.pushState(null, "", path);
      await sdk.heartbeat();
      expect(requests).toHaveLength(1);
    }
    history.pushState(null, "", "/demo/home");
    expect(requests.at(-1)?.body).toMatchObject({ type: "page_view", path: "/demo/home" });
    await sdk.heartbeat();
    expect(requests).toHaveLength(3);
  });

  it("starts counting after an excluded landing path navigates to an allowed path", () => {
    const { context, requests } = runSdk(undefined, undefined, { pathPrefixes: '["/demo"]' });
    expect(requests).toEqual([]);
    (context.history as { pushState: (state: unknown, unused: string, path: string) => void }).pushState(null, "", "/demo/home");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toMatchObject({ type: "page_view", path: "/demo/home" });
  });

  it("sends nothing with an empty allowlist", async () => {
    const { context, requests } = runSdk(undefined, undefined, { pathPrefixes: '[]' });
    await (context.LaunchBuddy as { heartbeat: () => Promise<unknown> }).heartbeat();
    expect(requests).toEqual([]);
  });

  it.each(['invalid', '{}', '[42]'])("reports invalid allowlist %s", (pathPrefixes) => {
    const { context, requests } = runSdk(undefined, undefined, { pathPrefixes });
    expect(requests).toEqual([]);
    expect(context.LaunchBuddy).toBeUndefined();
    expect((context.console as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalledWith(implementation === "script" ? "[Launch Buddy] Invalid data-path-prefixes." : "[Launch Buddy] Invalid pathPrefixes.");
  });
});

describe("hosted SDK restricted browser APIs", () => {
  it.each(["getter", "read", "write"] as const)("sends events with a stable in-memory session when sessionStorage blocks %s", async (blockedSession) => {
    const { context, requests } = runSdk(undefined, undefined, { blockedSession });
    expect(requests).toHaveLength(1);
    const sessionId = requests[0]!.body.sessionId;
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(requests[0]!.body.type).toBe("page_view");
    await (context.LaunchBuddy as { heartbeat(): Promise<unknown> }).heartbeat();
    expect(requests[1]!.body).toMatchObject({ type: "heartbeat", sessionId });
  });

  it("loads and sends a page view when the localStorage getter throws SecurityError", () => {
    const { context, requests } = runSdk(undefined, undefined, { blockedStorage: true, blockedCookie: true });
    expect(context.LaunchBuddy).toBeDefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toMatchObject({ type: "page_view", anonymousId: expect.any(String), sessionId: expect.any(String) });
  });

  it("reuses an existing session and persists a new session when storage is available", () => {
    expect(runSdk(undefined, undefined, { sessionId: "existing-session" }).requests[0]!.body.sessionId).toBe("existing-session");
    const { context, requests } = runSdk();
    expect((context.sessionStorage as ReturnType<typeof storage>).getItem("launch_buddy_session_id")).toBe(requests[0]!.body.sessionId);
  });

  it.each(["getter", "method-getter", "readonly"] as const)("still initializes when history blocks %s", (blockedHistory) => {
    const { context, requests } = runSdk(undefined, undefined, { blockedHistory });
    expect(context.LaunchBuddy).toBeDefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.type).toBe("page_view");
  });

  it("sends a page view when storage, cookies, and history getters all throw", () => {
    const { requests } = runSdk(undefined, undefined, { blockedSession: "getter", blockedStorage: true, blockedCookie: true, blockedHistory: "getter" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.type).toBe("page_view");
  });
});

});

it("matches the original fixture requests, cookie, and stored IDs byte for byte", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
  try {
    for (const options of [
      {},
      { href: "https://site.example/pricing?utm_source=Newsletter&gclid=private&email=private@example.com" },
      { blockedStorage: true, blockedCookie: true, blockedSession: "getter" as const },
      { pathPrefixes: '["/pricing"]', sessionId: "existing-session" },
      { href: `https://site.example/pricing?lb_check=${(Math.floor(Date.now()/1000)+600).toString(36)}.${"A".repeat(22)}.${"B".repeat(22)}` },
    ]) {
      const results = [];
      for (const implementation of ["script", "package"] as const) {
        const run = runner(implementation)(undefined, undefined, options);
        const sdk = run.context.LaunchBuddy as { heartbeat(): Promise<unknown> };
        await sdk.heartbeat();
        (run.context.history as { pushState(state: unknown, unused: string, path: string): void }).pushState({}, "", "/next");
        results.push(run.requests);
      }
      expect(results[1]).toEqual(results[0]);
    }
  } finally { vi.useRealTimers(); }
});
