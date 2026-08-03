// doorsign worker — minimal message drop-box.
// POST /messages  {name?, text}  -> KV (30-day TTL) + Slack notification
// GET  /messages                 -> anonymous stickies [{id, ts}]
// GET  /messages + Bearer ADMIN_KEY -> full messages
//
// Secrets (wrangler secret put): SLACK_WEBHOOK_URL, ADMIN_KEY
// Vars (wrangler.toml): ALLOWED_ORIGIN
// KV binding: NOTES

const MAX_TEXT = 500;
const MAX_NAME = 50;
const TTL_SECONDS = 30 * 24 * 3600;      // 30 days — KV expires notes itself
const RATE_LIMIT = 5;                    // posts per IP per hour
const MAX_LIST = 30;                     // stickies shown on the door

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json", ...cors },
      });

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(req.url);
    if (url.pathname !== "/messages") return json({ error: "not found" }, 404);

    // ---------- POST: leave a note ----------
    if (req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }

      // Honeypot: hidden "website" field. Bots fill it; humans never see it.
      if (body.website) return json({ ok: true }); // silently drop

      const text = (body.text || "").toString().trim();
      const name = (body.name || "").toString().trim().slice(0, MAX_NAME);
      if (!text) return json({ error: "empty message" }, 400);
      if (text.length > MAX_TEXT) return json({ error: `max ${MAX_TEXT} chars` }, 400);

      // Rate limit: KV counter per IP, 1h window.
      const ip = req.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = `rl:${ip}`;
      const count = parseInt((await env.NOTES.get(rlKey)) || "0", 10);
      if (count >= RATE_LIMIT) return json({ error: "too many notes, try later" }, 429);
      await env.NOTES.put(rlKey, String(count + 1), { expirationTtl: 3600 });

      // Store. Timestamp embedded in the id so anonymous listing needs no reads.
      const ts = Date.now();
      const id = `${ts}-${crypto.randomUUID().slice(0, 8)}`;
      await env.NOTES.put(
        `msg:${id}`,
        JSON.stringify({ name, text, ts }),
        { expirationTtl: TTL_SECONDS }
      );

      // Slack notification. Failure here shouldn't lose the note.
      try {
        const clean = text.replace(/[\u0000-\u001F]/g, " ");
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `:pushpin: New door note${name ? ` from *${name}*` : ""}:\n>${clean}`,
          }),
        });
      } catch (e) {
        // AIDEV-NOTE: note is stored even if Slack is down; check KV if webhook flaky
        console.error("slack webhook failed", e);
      }

      return json({ ok: true, id });
    }

    // ---------- DELETE: admin wipes all notes ----------
    if (req.method === "DELETE") {
      const isAdmin =
        req.headers.get("Authorization") === `Bearer ${env.ADMIN_KEY}`;
      if (!isAdmin) return json({ error: "unauthorized" }, 401);

      let deleted = 0;
      let cursor;
      do {
        const page = await env.NOTES.list({ prefix: "msg:", cursor });
        await Promise.all(page.keys.map((k) => env.NOTES.delete(k.name)));
        deleted += page.keys.length;
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);

      return json({ ok: true, deleted });
    }

    // ---------- GET: list notes ----------
    if (req.method === "GET") {
      const list = await env.NOTES.list({ prefix: "msg:" });
      const keys = list.keys
        .sort((a, b) => (a.name < b.name ? 1 : -1)) // newest first (ts prefix)
        .slice(0, MAX_LIST);

      const isAdmin =
        req.headers.get("Authorization") === `Bearer ${env.ADMIN_KEY}`;

      if (!isAdmin) {
        // Semi-private: existence + age only. No text, no name.
        return json(
          keys.map((k) => {
            const id = k.name.slice(4);
            return { id, ts: parseInt(id.split("-")[0], 10) };
          })
        );
      }

      const full = await Promise.all(
        keys.map(async (k) => {
          const v = await env.NOTES.get(k.name, "json");
          return v ? { id: k.name.slice(4), ...v } : null;
        })
      );
      return json(full.filter(Boolean));
    }

    return json({ error: "method not allowed" }, 405);
  },
};
