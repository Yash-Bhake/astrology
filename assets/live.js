/* live.js — Firebase Realtime Database client over plain REST + EventSource.
 *
 * No SDK, no CDN, nothing to fail on venue WiFi. Firebase's REST endpoint
 * streams Server-Sent Events when the request carries `Accept: text/event-stream`,
 * which EventSource sets automatically.
 *
 *   Live.submit(qid, value)      -> push one response
 *   Live.subscribe(qid, handler) -> handler(arrayOfValues) on every change
 *   Live.clear(qid)              -> wipe responses for one question
 *   Live.enabled                 -> false when no databaseURL is configured
 *   Live.audienceURL(qid)        -> the URL a QR code should encode
 */
(function (global) {
  "use strict";

  var cfg = global.DECK_CONFIG || {};
  var DB = String(cfg.databaseURL || "").replace(/\/+$/, "");
  var SESSION = cfg.session || "live";
  var enabled = /^https:\/\//.test(DB);

  function endpoint(qid) {
    return DB + "/sessions/" + encodeURIComponent(SESSION) + "/" + encodeURIComponent(qid) + ".json";
  }

  function audienceBase() {
    if (cfg.baseURL) return String(cfg.baseURL).replace(/\/+$/, "");
    // derive from wherever this page is served: .../index.html -> ...
    var u = global.location.href.split(/[?#]/)[0];
    return u.replace(/\/[^\/]*$/, "");
  }

  function audienceURL(qid) {
    return audienceBase() + "/respond.html?q=" + encodeURIComponent(qid) +
           "&s=" + encodeURIComponent(SESSION);
  }

  function submit(qid, value) {
    if (!enabled) return Promise.reject(new Error("No databaseURL configured in config.js"));
    return fetch(endpoint(qid), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: value, t: Date.now() })
    }).then(function (r) {
      if (!r.ok) throw new Error("Submit failed (" + r.status + ")");
      return r.json();
    });
  }

  function clear(qid) {
    if (!enabled) return Promise.resolve();
    return fetch(endpoint(qid), { method: "DELETE" });
  }

  /* Subscribe to one question. Returns an unsubscribe function.
     `handler` receives a plain array of the submitted values. */
  function subscribe(qid, handler, onStatus) {
    if (!enabled) { handler([]); if (onStatus) onStatus("off"); return function () {}; }

    var state = {};
    var es = new EventSource(endpoint(qid));

    function emit() {
      var out = [];
      Object.keys(state).forEach(function (k) {
        var rec = state[k];
        if (rec && typeof rec === "object" && "v" in rec) out.push(rec.v);
      });
      handler(out);
    }

    function applyPut(p, d) {
      if (p === "/") {
        state = d || {};
      } else {
        var key = p.replace(/^\//, "").split("/")[0];
        if (d === null) delete state[key];
        else state[key] = d;
      }
    }

    es.addEventListener("put", function (e) {
      try { var m = JSON.parse(e.data); applyPut(m.path, m.data); emit(); } catch (_) {}
    });

    es.addEventListener("patch", function (e) {
      try {
        var m = JSON.parse(e.data);
        var root = m.path === "/" ? "" : m.path.replace(/^\//, "") + "/";
        Object.keys(m.data || {}).forEach(function (k) {
          applyPut("/" + root + k, m.data[k]);
        });
        emit();
      } catch (_) {}
    });

    es.addEventListener("open", function () { if (onStatus) onStatus("live"); });
    es.onerror = function () { if (onStatus) onStatus("retrying"); };  // EventSource reconnects itself

    return function () { es.close(); };
  }

  global.Live = {
    enabled: enabled,
    session: SESSION,
    submit: submit,
    clear: clear,
    subscribe: subscribe,
    audienceURL: audienceURL,
    audienceBase: audienceBase
  };
})(window);
