# Retire the old bot (@foodlog2111_bot) — checklist

Run this when you tell me "it's time to retire the old bot." The SnapBite cutover is
already done; this only decommissions the OLD FoodLog infrastructure. Do it once you're
confident the new bot works for all users (a few days of stable use is ideal).

## Prerequisites (confirm before starting)
- [ ] `@SnapBiteAI_bot` has been working for users (history, keys, new photos all good).
- [ ] The "we've moved" broadcast (v0.19.0) was delivered to all old-bot users.
- [ ] You've given users enough time to switch over.

## Steps

### 1. Silence the old bot (reversible)
Removes the webhook so `@foodlog2111_bot` stops responding. Reversible — you can re-set
the webhook if needed.
```
curl "https://api.telegram.org/bot<OLD_FOODLOG2111_TOKEN>/deleteWebhook"
```
Expected: `{"ok":true,"result":true,"description":"Webhook was deleted"}`

### 2. Delete the old Cloudflare Worker
```
cd apps/worker
pnpm exec wrangler delete --name foodlog-worker
```
(Or delete `foodlog-worker` in the Cloudflare dashboard → Workers.)

### 3. Delete the old Pages project
Dashboard → Workers & Pages → `foodlog` → Settings → Delete project.
(URL was `https://foodlog-7f5.pages.dev`.)

### 4. KEEP the old D1 database as a backup for now
- Old D1: `foodlog-db`, id `f0312e67-2fef-47a6-a9ca-59cb9c21a79b`.
- Do NOT delete yet — it's the migration safety net.
- Once you're 100% sure `snapbite-db` has everything (give it a couple of weeks), delete via:
  ```
  cd apps/worker && pnpm exec wrangler d1 delete foodlog-db
  ```

### 5. Optional: fully delete the old bot in BotFather
BotFather → `/mybots` → `@foodlog2111_bot` → Delete Bot. (Frees the token; irreversible.)

## Repo cleanup (tell me and I'll do these)
- [ ] Remove `apps/worker/wrangler.old.toml` (the temporary old-worker deploy config).
- [ ] Trim the "we've moved" broadcast changelog entry if you don't want it re-sending.
- [ ] Update `PLAN.md` "RETIRED" section to mark the old infra as fully deleted.

## Rollback (if something's wrong on the new bot)
- Re-set the old bot's webhook to the old worker:
  ```
  curl "https://api.telegram.org/bot<OLD_TOKEN>/setWebhook?url=https://foodlog-worker.lgf2111.workers.dev/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
  ```
- The old worker + `foodlog-db` remain intact until you complete steps 2–4, so rollback is
  possible any time before then.
