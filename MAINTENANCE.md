# doorsign — KV maintenance

All notes live in one KV namespace (`NOTES`), keys prefixed `msg:`.
Rate-limit counters use prefix `rl:`. Everything expires on its own
(notes 30 d, counters 1 h) — these commands are for acting *before* expiry.

Run from `worker/` (where `wrangler.toml` lives). Set once per shell:

```bash
export NS=5950d756f55144369da2bb7615c36335   # your NOTES namespace id
```

## Inspect

```bash
# List all note keys (timestamp is embedded in the key name)
wrangler kv key list --namespace-id $NS --prefix msg: | jq .

# Read one note's content
wrangler kv key get "msg:<id>" --namespace-id $NS

# Count notes
wrangler kv key list --namespace-id $NS --prefix msg: | jq length
```

## Delete one note (take a post-it off the door)

```bash
wrangler kv key delete "msg:<id>" --namespace-id $NS
```

## Reset: delete ALL notes before expiration

```bash
wrangler kv key list --namespace-id $NS --prefix msg: \
  | jq '[.[].name]' > /tmp/doorsign-keys.json

wrangler kv bulk delete /tmp/doorsign-keys.json --namespace-id $NS
```

`bulk delete` asks for confirmation; add `--force` to skip. The `--prefix msg:`
matters — without it you'd also wipe unexpired `rl:` counters (harmless, but
it resets everyone's rate limit).

## Delete notes older than N days

Timestamps are the first field of the key (`msg:<epoch_ms>-<rand>`), so no
value reads needed:

```bash
DAYS=7
CUTOFF=$(( $(date +%s%3N) - DAYS*86400000 ))
wrangler kv key list --namespace-id $NS --prefix msg: \
  | jq --argjson c $CUTOFF '[.[].name | select((split(":")[1] | split("-")[0] | tonumber) < $c)]' \
  > /tmp/doorsign-old.json
wrangler kv bulk delete /tmp/doorsign-old.json --namespace-id $NS
```

macOS note: `date +%s%3N` needs GNU date (`brew install coreutils`, use
`gdate`). Or: `CUTOFF=$(( $(date +%s) * 1000 - DAYS*86400000 ))`.

## Clear rate-limit counters (unblock an IP)

```bash
wrangler kv key list --namespace-id $NS --prefix rl: | jq '[.[].name]' > /tmp/rl.json
wrangler kv bulk delete /tmp/rl.json --namespace-id $NS --force
```

## Gotchas

- KV list is eventually consistent — a just-posted note may take ~60 s to
  show up in `key list`, and deletions take ~60 s to disappear from the page.
- These commands hit the remote namespace. Local dev (`wrangler dev`) uses a
  separate local store; add `--local` to target that one instead.
- Free-tier quota: deletes count as writes (1,000/day). A full wipe of a
  door's worth of notes is nowhere near it.
- The namespace id is not a secret, but keep this file out of the public
  Pages repo anyway if it lives alongside — it belongs with `worker/`.
