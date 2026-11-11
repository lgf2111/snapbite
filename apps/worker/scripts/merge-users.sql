-- Merge one SnapBite user into another. You supply BOTH ids; nothing is guessed.
--
--   @FROM  the account to retire: the one that holds the meals (e.g. the Telegram
--          account a restore left without an email).
--   @INTO  the account to keep: the one the person signs in to now (e.g. the empty
--          Google account). Its email stays; it takes over @FROM's Telegram id.
--
-- Run it with ids substituted in, from apps/worker (see docs/restore-runbook.md):
--
--   FROM=<source user id> INTO=<target user id>
--   sed "s/@FROM/$FROM/g; s/@INTO/$INTO/g" scripts/merge-users.sql > /tmp/merge.sql
--   wrangler d1 execute snapbite-db --remote --file /tmp/merge.sql
--
-- FIRST look at both rows and their counts, and take a Time Travel bookmark:
--   select id, telegram_user_id, email, (select count(*) from meals where user_id = users.id) meals
--     from users where id in ('@FROM', '@INTO');
--
-- Every statement below is guarded so a typo cannot half-run: both ids must exist
-- and differ. Child rows of meals (food_items, nutrition) follow their meal.
-- `user_activity` is keyed by the Telegram id, not the user id, so it needs no move.
-- If @INTO already has settings, @FROM's replace them (the point of the merge is
-- to keep the profile and key that were set up); if @FROM has none, @INTO's stay.

-- The Telegram id has to leave @FROM before @INTO can take it (unique index), and
-- the email has to leave @FROM so the unique index cannot trip on it either.
CREATE TABLE _merge_carry AS
  SELECT telegram_user_id FROM users WHERE id = '@FROM' AND '@FROM' <> '@INTO'
    AND EXISTS (SELECT 1 FROM users WHERE id = '@INTO');
UPDATE users SET telegram_user_id = NULL, email = NULL
  WHERE id = '@FROM' AND EXISTS (SELECT 1 FROM _merge_carry);
UPDATE users SET telegram_user_id = (SELECT telegram_user_id FROM _merge_carry)
  WHERE id = '@INTO' AND telegram_user_id IS NULL AND EXISTS (SELECT 1 FROM _merge_carry);

DELETE FROM settings
  WHERE user_id = '@INTO' AND EXISTS (SELECT 1 FROM _merge_carry)
    AND EXISTS (SELECT 1 FROM settings WHERE user_id = '@FROM');
UPDATE settings SET user_id = '@INTO'
  WHERE user_id = '@FROM' AND EXISTS (SELECT 1 FROM _merge_carry);
UPDATE meals SET user_id = '@INTO'
  WHERE user_id = '@FROM' AND EXISTS (SELECT 1 FROM _merge_carry);
UPDATE saved_meals SET user_id = '@INTO'
  WHERE user_id = '@FROM' AND EXISTS (SELECT 1 FROM _merge_carry);
UPDATE sessions SET user_id = '@INTO'
  WHERE user_id = '@FROM' AND EXISTS (SELECT 1 FROM _merge_carry);
UPDATE device_tokens SET user_id = '@INTO'
  WHERE user_id = '@FROM' AND EXISTS (SELECT 1 FROM _merge_carry);
UPDATE push_subscriptions SET user_id = '@INTO'
  WHERE user_id = '@FROM' AND EXISTS (SELECT 1 FROM _merge_carry);

-- Only remove the source once nothing is left under it. Anything still there means
-- a table was added after this script was written: the row stays, and so does its data.
DELETE FROM users
  WHERE id = '@FROM' AND EXISTS (SELECT 1 FROM _merge_carry)
    AND NOT EXISTS (SELECT 1 FROM meals WHERE user_id = '@FROM')
    AND NOT EXISTS (SELECT 1 FROM settings WHERE user_id = '@FROM')
    AND NOT EXISTS (SELECT 1 FROM saved_meals WHERE user_id = '@FROM')
    AND NOT EXISTS (SELECT 1 FROM sessions WHERE user_id = '@FROM')
    AND NOT EXISTS (SELECT 1 FROM device_tokens WHERE user_id = '@FROM')
    AND NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = '@FROM');
DROP TABLE _merge_carry;
