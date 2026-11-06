export type LaunchBuddyOptions = {
  projectKey: string;
  endpoint?: string;
  pathPrefixes?: string[];
  debug?: boolean;
};

export type DeliveryResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "excluded_path" | "duplicate_path" }
  | { status: "failed"; reason: "http_rejected"; statusCode: number }
  | { status: "failed"; reason: "network_error" };

export type LaunchBuddyClient = {
  version: string;
  anonymousId(): string;
  pageView(): Promise<DeliveryResult>;
  heartbeat(): Promise<DeliveryResult>;
};

type BrowserEvent = {
  version: 1;
  eventId: string;
  type: "page_view" | "heartbeat";
  projectKey: string;
  occurredAt: string;
  anonymousId: string;
  sessionId: string;
  locale: string;
  sdk: { name: string; version: string };
  checkToken?: string;
  path?: string;
  campaign?: Record<string, string>;
  adClicks?: string[];
  referrerOrigin?: string;
};

declare global {
  interface Window {
    __launchBuddyLoaded?: boolean;
    LaunchBuddy?: LaunchBuddyClient;
    launchBuddy?: LaunchBuddyClient;
  }
}

export function init(options: LaunchBuddyOptions): LaunchBuddyClient | undefined {
  if (typeof window === "undefined") return;
  if (window.__launchBuddyLoaded) return window.LaunchBuddy;
  const { projectKey, pathPrefixes = null, debug = false } = options;
  const endpoint = options.endpoint || "https://launchbuddy.points-playground.com/api/v1/events";
  if (pathPrefixes !== null && (!Array.isArray(pathPrefixes) || pathPrefixes.some(prefix => typeof prefix !== "string" || prefix.charAt(0) !== "/"))) {
    console.error("[Launch Buddy] Invalid pathPrefixes.");
    return;
  }
  if (!projectKey || !/^lb_public_[A-Za-z0-9_-]{12,}$/.test(projectKey)) {
    console.error("[Launch Buddy] Missing or invalid projectKey.");
    return;
  }
  window.__launchBuddyLoaded = true;

  function allowedPath() {
    var path = window.location.pathname || "/";
    return pathPrefixes === null || pathPrefixes.some(function (prefix) {
      return path === prefix || (prefix !== "/" && path.indexOf(prefix + "/") === 0);
    });
  }

  function id() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (character) {
      var random = Math.random() * 16 | 0;
      var value = character === "x" ? random : (random & 3 | 8);
      return value.toString(16);
    });
  }

  function storedId(storageName: "localStorage" | "sessionStorage", key: string): string {
    try {
      var storage = window[storageName];
      var current = storage.getItem(key);
      if (current) return current;
      var created = id();
      storage.setItem(key, created);
      return created;
    } catch {
      return id();
    }
  }

  function visitorId() {
    var current;
    try { current = window.localStorage.getItem("launch_buddy_visitor_id"); } catch {}
    if (!current) {
      try {
        var match = (document.cookie || "").match(/(?:^|;\s*)lb_aid=([0-9a-f-]+)(?:;|$)/);
        if (match && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(match[1]!)) current = match[1];
      } catch {}
    }
    current = current || id();
    try { window.localStorage.setItem("launch_buddy_visitor_id", current); } catch {}
    try {
      document.cookie = "lb_aid=" + encodeURIComponent(current) + "; Path=/; SameSite=Lax; Max-Age=31536000" +
        (window.location.protocol === "https:" ? "; Secure" : "");
    } catch {}
    return current;
  }

  var checkToken: string | undefined;
  var checkExpiresAt = 0;
  try {
    var checkUrl = new URL(window.location.href);
    var checkValues = checkUrl.searchParams.getAll("lb_check");
    if (checkValues.length === 1 && /^[a-z0-9]{6,8}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/.test(checkValues[0]!)) {
      var expiry = parseInt(checkValues[0]!.split(".")[0]!, 36) * 1000;
      if (expiry > Date.now() && expiry <= Date.now() + 15 * 60 * 1000) { checkToken = checkValues[0]!; checkExpiresAt = expiry; }
    }
    if (checkValues.length) {
      checkUrl.searchParams.delete("lb_check");
      window.history.replaceState(window.history.state, "", checkUrl.pathname + checkUrl.search + checkUrl.hash);
    }
  } catch {}

  var campaign: Record<string, string> = {};
  var adClicks: string[] = [];
  try {
    var landing = new URL(window.location.href).searchParams;
    ["utm_source", "utm_medium", "utm_campaign", "ref", "via", "source"].forEach(function (key) {
      var value = (landing.get(key) || "").trim().toLowerCase();
      if (value && value.length <= 64 && /^[a-z][a-z0-9 ._-]*$/.test(value) && !/\d{5}/.test(value)) campaign[key] = value;
    });
    [["gclid", "google"], ["fbclid", "meta"], ["msclkid", "microsoft"], ["twclid", "x"]].forEach(function (click) {
      if (landing.has(click[0]!)) adClicks.push(click[1]!);
    });
  } catch {}

  var anonymousId = visitorId();
  var sessionId = storedId("sessionStorage", "launch_buddy_session_id");

  function referrerOrigin() {
    if (!document.referrer) return undefined;
    try {
      return new URL(document.referrer).origin;
    } catch {
      return undefined;
    }
  }

  function send(type: "page_view" | "heartbeat"): Promise<DeliveryResult> {
    if (!allowedPath()) return Promise.resolve({ status: "skipped", reason: "excluded_path" });
    if (checkToken && Date.now() >= checkExpiresAt) checkToken = undefined;
    var event: BrowserEvent = {
      version: 1,
      eventId: id(),
      type: type,
      projectKey: projectKey,
      occurredAt: new Date().toISOString(),
      anonymousId: anonymousId,
      sessionId: sessionId,
      locale: navigator.language,
      sdk: { name: "@launch-buddy/next", version: "0.1.0" }
    };

    if (checkToken) event.checkToken = checkToken;
    if (type === "page_view") {
      event.path = window.location.pathname || "/";
      if (Object.keys(campaign).length) event.campaign = campaign;
      if (adClicks.length) event.adClicks = adClicks;
      var origin = referrerOrigin();
      if (origin) event.referrerOrigin = origin;
    }

    return window.fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      credentials: "omit",
      keepalive: true,
      mode: "cors"
    }).then(function (response): DeliveryResult {
      if (!response.ok && debug && window.console) {
        console.warn("[Launch Buddy] Signal rejected with status " + response.status + ".");
      }
      return response.ok
        ? { status: "sent" }
        : { status: "failed", reason: "http_rejected", statusCode: response.status };
    }).catch(function () {
      if (debug && window.console) console.warn("[Launch Buddy] Signal could not be sent.");
      return { status: "failed", reason: "network_error" };
    });
  }

  var previousPath: string | null = null;
  function pageView(): Promise<DeliveryResult> {
    if (!allowedPath()) {
      previousPath = null;
      return Promise.resolve({ status: "skipped", reason: "excluded_path" });
    }
    var path = window.location.pathname || "/";
    if (path === previousPath) {
      return Promise.resolve({ status: "skipped", reason: "duplicate_path" });
    }
    previousPath = path;
    return send("page_view");
  }

  function wrapHistory(method: "pushState" | "replaceState") {
    try {
      var history = window.history;
      var original = history[method];
      if (typeof original !== "function") return;
      history[method] = function (...args: Parameters<History["pushState"]>) {
        var result = original.apply(this, args);
        window.setTimeout(pageView, 0);
        return result;
      };
    } catch {}
  }

  wrapHistory("pushState");
  wrapHistory("replaceState");
  window.addEventListener("popstate", pageView);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") send("heartbeat");
  });
  window.setInterval(function () {
    if (document.visibilityState === "visible") send("heartbeat");
  }, 30000);

  window.LaunchBuddy = {
    version: "0.1.0",
    anonymousId: function () { return anonymousId; },
    pageView: pageView,
    heartbeat: function () { return send("heartbeat"); }
  };

  window.launchBuddy = window.LaunchBuddy;

  void pageView();
  return window.LaunchBuddy;
}
