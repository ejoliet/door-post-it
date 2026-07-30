# doorsign v2 — door with post-its

Scan the QR on the door → see a door with anonymous sticky notes → leave one.
Note is stored 30 days and pings Emmanuel on Slack. Only he reads the text.

## Architecture

```
GitHub Pages (index.html)  ──POST /messages──▶  Cloudflare Worker
                           ◀──GET  /messages──   ├─ KV "NOTES" (30-day TTL)
                                                 └─ Slack incoming webhook (secret)
```

- Public GET returns `[{id, ts}]` only — existence and age, no text, no name.
- `GET` with `Authorization: Bearer ADMIN_KEY` returns full messages.
- Slack notification carries the full text, so day-to-day you read notes in Slack.

## Deploy the worker

```bash
npm i -g wrangler
cd worker
wrangler login
wrangler kv namespace create NOTES        # paste id into wrangler.toml
# Slack: api.slack.com → Your Apps → Incoming Webhooks → pick your DM/channel
wrangler secret put SLACK_WEBHOOK_URL
# Admin key: generate, keep out of the repo
openssl rand -hex 24 | wrangler secret put ADMIN_KEY
# Set ALLOWED_ORIGIN in wrangler.toml to your Pages origin
wrangler deploy                            # prints https://doorsign.<sub>.workers.dev
```

## Wire the page

In `index.html` `CONFIG`: set `apiBase` to the worker URL, plus email,
Slack team/user IDs, scheduler URL, name, room. Push to the Pages repo.

## Admin mode (read notes on the page)

Bookmark on your phone:

```
https://YOU.github.io/doorsign/#admin=YOUR_ADMIN_KEY
```

The key rides in the URL fragment — browsers never send fragments to any
server, and the page keeps it in memory only. Treat the bookmark like a
password; rotate with `wrangler secret put ADMIN_KEY` if it leaks.

## Test

```bash
BASE=https://doorsign.<sub>.workers.dev
curl -s -X POST $BASE/messages -H 'content-type: application/json' \
  -d '{"text":"test note","name":"curl"}'
curl -s $BASE/messages                                  # anonymous list
curl -s $BASE/messages -H "Authorization: Bearer $KEY"  # full list
```

Expect: Slack ping on the POST; anonymous list shows `{id, ts}` only.

## Abuse controls built in

- 500-char limit, 50-char name limit
- 5 posts/hour/IP (KV counter)
- Off-screen honeypot field (bots silently dropped)
- CORS locked to your Pages origin
- If real spam shows up: add Cloudflare Turnstile (free) — ~10 lines in
  worker + one widget on the form

## Known limits (fine for a door sign)

- KV `list` is eventually consistent: a new sticky can take up to ~60 s to
  appear for *other* visitors. The poster sees theirs instantly (added
  client-side).
- CORS is an origin allowlist, not auth — anyone can still `curl` the POST
  endpoint. Rate limit + honeypot + length cap are the real controls.
- Free KV tier: 1,000 writes/day. A door sign will never touch it.

## Costs

$0. Cloudflare Workers free tier + GitHub Pages.

## Files

- `index.html` — door page (v2)
- `index.v1.html` — previous button-only page, kept for reference
- `status.json`, `contact.vcf` — unchanged from v1
- `worker/worker.js`, `worker/wrangler.toml` — backend
