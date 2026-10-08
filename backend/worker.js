/* St Stephen's Report Card System — sync backend.
   Paste this into a new Cloudflare Worker (Workers & Pages -> Create ->
   "Hello World" template -> replace all the code with this), bind a KV
   namespace to it named REPORTCARD_KV, then copy the Worker's URL into
   the app's Admin tab -> Sync URL field.

   This is deliberately a simple store: the client (sync.js) already does
   the real per-field/per-record merge before it ever pushes here — this
   Worker's job is just to hold the latest merged blob and hand it back.
   All the actual conflict resolution — same field on two devices, a
   delete vs. a stale copy, different fields on different devices — is
   handled client-side before it reaches this file. */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
};

const EMPTY_STATE = { sections: {} };
const MAX_BODY_CHARS = 10 * 1000 * 1000; // KV values are capped at 25 MB; stay well inside it

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

// A short fingerprint of the stored data. Devices send it back (If-None-Match) on every
// check; when nothing has changed the Worker answers "304 Not Modified" with no body, so an
// idle device downloads a few hundred bytes instead of the whole database every time.
async function etagOf(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return '"' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("") + '"';
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    if (request.method === "GET") {
      const raw = await env.REPORTCARD_KV.get("state");
      const body = raw ? raw : JSON.stringify(EMPTY_STATE);
      const etag = await etagOf(body);
      const headers = { "Content-Type": "application/json", "Cache-Control": "no-cache", "ETag": etag, ...CORS_HEADERS };
      if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
      return new Response(body, { headers });
    }

    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > MAX_BODY_CHARS) return json({ ok: false, error: "Too large" }, 413);
      let body;
      try { body = JSON.parse(text); } catch (e) { return json({ ok: false, error: "Invalid JSON" }, 400); }
      // Refuse anything that is not the app's own shape, so a stray request can never
      // overwrite the whole school's data with junk.
      if (!body || typeof body !== "object" || !body.sections || typeof body.sections !== "object" || Array.isArray(body.sections)) {
        return json({ ok: false, error: "Not a report-card sync payload" }, 400);
      }
      await env.REPORTCARD_KV.put("state", JSON.stringify(body));
      // Just an acknowledgement: the app already merged everything before sending, so there
      // is nothing to send back (the old version echoed the whole database on every save).
      return json({ ok: true });
    }

    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  },
};
