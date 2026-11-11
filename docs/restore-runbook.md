# Restoring the database

Production data lives in D1 (`snapbite-db`). Two safety nets, fastest first:

1. **Time travel**: Cloudflare keeps 30 days of point-in-time history. Use this first.
2. **Nightly export**: `.github/workflows/d1-backup.yml` saves a SQL dump at 02:00 SGT
   as an artifact for 90 days. Use it for anything older than 30 days, or to look at
   data without touching production.

Run the commands from `apps/worker` (that is where `snapbite-db` is defined).

## When data disappears

1. **Stop writing if you can.** Nothing here needs it, but every new row after the
   restore point is lost by a restore.
2. **See where the database is now:**
   ```
   wrangler d1 time-travel info snapbite-db
   ```
   Shows the current bookmark and how far back you can go.
3. **Find the bookmark from before it broke.** There is no "list"; ask for the
   bookmark at a time you know was good (UTC, RFC 3339 or a unix timestamp):
   ```
   wrangler d1 time-travel info snapbite-db --timestamp=2026-11-11T09:00:00Z
   ```
   Check a time just before the incident, and one earlier if you are unsure.
4. **Restore:**
   ```
   wrangler d1 time-travel restore snapbite-db --bookmark=<bookmark from step 3>
   ```
   It prints a bookmark for the state you just left. **Keep it**: restoring to that
   bookmark undoes the restore.
5. **Re-apply migrations, immediately** (see the first trap):
   ```
   wrangler d1 migrations apply snapbite-db --remote
   ```
6. **Verify the counts**, against what you expect:
   ```
   wrangler d1 execute snapbite-db --remote --command \
     "select (select count(*) from users) users, (select count(*) from meals) meals, (select count(*) from settings) settings"
   ```
   Then sign in on the site and open Home.

## The two traps (both hit)

- **A restore rolls the schema back, not just the data.** Anything migrated after the
  bookmark is gone, so the Worker (already deployed with newer code) is running
  against an older schema. We saw sign-in return 500 because `sessions.method`
  (migration `0016`) was missing. `migrations apply` right after the restore fixes
  it; do not leave the gap open.
- **A restore brings back junk created after the bookmark was good.** Anonymous
  accounts are created for every visitor, so a restore can resurrect hundreds of
  empty `users` rows. That is expected; they hold nothing. Do not "fix" the count.

## Using a nightly backup

Each run attaches `backup-YYYY-MM-DD.sql` (kept 90 days) and prints row counts in
the run's summary. The file contains everyone's meals and (encrypted) API keys:
treat it as sensitive, keep it off shared drives, delete the local copy when done.

1. Download it:
   ```
   gh run list --workflow=d1-backup.yml --limit 10
   gh run download <run-id> --name d1-backup-YYYY-MM-DD
   ```
   (or from the run page in the GitHub Actions tab).
2. Load it into a throwaway local database and look around:
   ```
   sqlite3 inspect.db < backup-YYYY-MM-DD.sql
   sqlite3 inspect.db "select count(*) from users; select count(*) from meals;"
   sqlite3 inspect.db "select id, label, created_at from meals where user_id = '<id>' order by created_at desc limit 20;"
   ```
3. Getting rows back into production is a manual copy of what you need (for example
   `insert` statements for one user's meals). Replaying the whole file with
   `wrangler d1 execute snapbite-db --remote --file=...` only works on an empty
   database; prefer time travel for a full restore.

## If the backup job goes red

- **"only N bytes (< 100 KB)"**: the database was empty or the export failed. Look at
  the export step's log, and treat it as an incident until you have checked the data.
- **"D1 backup is missing repository secrets"**: the first step failed on purpose.
  Create a token with D1 edit rights at https://dash.cloudflare.com/profile/api-tokens
  and run `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID`
  (`gh secret list` shows what is set). Editing the workflow file also triggers a run
  of it, so this is how a fix to the workflow proves itself.
- **Other auth errors**: both secrets are set but wrong, or the token lacks D1 edit
  rights (export works through the D1 API).
- GitHub pauses scheduled workflows after 60 days with no repository activity. If
  the nightly runs stop appearing, re-enable the workflow in the Actions tab.
