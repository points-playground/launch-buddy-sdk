(function launchBuddyBrowserSdk() {
  "use strict";

  if (window.__launchBuddyLoaded) return;

  var script = document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName("script");
    script = scripts[scripts.length - 1];
  }

  var projectKey = script && script.getAttribute("data-project-key");
  var pathPrefixes = script && script.getAttribute("data-path-prefixes");
  try {
    pathPrefixes = pathPrefixes === null ? null : JSON.parse(pathPrefixes);
  } catch {
    if (window.console) console.error("[Launch Buddy] Invalid data-path-prefixes.");
    return;
  }
  if (pathPrefixes !== null && (!Array.isArray(pathPrefixes) || pathPrefixes.some(function (prefix) {
    return typeof prefix !== "string" || prefix.charAt(0) !== "/";
  }))) {
    if (window.console) console.error("[Launch Buddy] Invalid data-path-prefixes.");
    return;
  }

  function allowedPath() {
    var path = window.location.pathname || "/";
    return pathPrefixes === null || pathPrefixes.some(function (prefix) {
      return path === prefix || (prefix !== "/" && path.indexOf(prefix + "/") === 0);
    });
  }

  var debug = script && script.hasAttribute("data-debug");
  if (!projectKey || !/^lb_public_[A-Za-z0-9_-]{12,}$/.test(projectKey)) {
    if (window.console) console.error("[Launch Buddy] Missing or invalid data-project-key.");
    return;
  }
  window.__launchBuddyLoaded = true;

  var endpoint;
  try {
    endpoint = (script && script.getAttribute("data-endpoint")) ||
      new URL("/api/v1/events", script.src).toString();
  } catch {
    endpoint = "https://launchbuddy.points-playground.com/api/v1/events";
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

  function storedId(storageName, key) {
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
        if (match && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(match[1])) current = match[1];
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

  var checkToken;
  var checkExpiresAt = 0;
  try {
    var checkUrl = new URL(window.location.href);
    var checkValues = checkUrl.searchParams.getAll("lb_check");
    if (checkValues.length === 1 && /^[a-z0-9]{6,8}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/.test(checkValues[0])) {
      var expiry = parseInt(checkValues[0].split(".")[0], 36) * 1000;
      if (expiry > Date.now() && expiry <= Date.now() + 15 * 60 * 1000) { checkToken = checkValues[0]; checkExpiresAt = expiry; }
    }
    if (checkValues.length) {
      checkUrl.searchParams.delete("lb_check");
      window.history.replaceState(window.history.state, "", checkUrl.pathname + checkUrl.search + checkUrl.hash);
    }
  } catch {}

  var campaign = {};
  var adClicks = [];
  try {
    var landing = new URL(window.location.href).searchParams;
    ["utm_source", "utm_medium", "utm_campaign", "ref", "via", "source"].forEach(function (key) {
      var value = (landing.get(key) || "").trim().toLowerCase();
      if (value && value.length <= 64 && /^[a-z][a-z0-9 ._-]*$/.test(value) && !/\d{5}/.test(value)) campaign[key] = value;
    });
    [["gclid", "google"], ["fbclid", "meta"], ["msclkid", "microsoft"], ["twclid", "x"]].forEach(function (click) {
      if (landing.has(click[0])) adClicks.push(click[1]);
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

  function send(type) {
    if (!allowedPath()) return Promise.resolve({ status: "skipped", reason: "excluded_path" });
    if (checkToken && Date.now() >= checkExpiresAt) checkToken = undefined;
    var event = {
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
    }).then(function (response) {
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

  var previousPath = null;
  function pageView() {
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

  function wrapHistory(method) {
    try {
      var history = window.history;
      var original = history[method];
      if (typeof original !== "function") return;
      history[method] = function () {
        var result = original.apply(this, arguments);
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

  pageView();
})();
