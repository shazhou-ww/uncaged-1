-- Migration: Update memory session tags from legacy to unified format
-- Part of Issue #21: Multi-tenant user model key migration
--
-- Prerequisites:
--   1. users + credentials tables must be populated first
--   2. Run per-instance after user creation
--
-- Legacy formats:
--   chat_id = "telegram:Scott"      → from Telegram channel
--   chat_id = "doudou:Scott"        → from instance-scoped format
--   chat_id = "web:email@example.com" → from web channel (KV only, not in D1)
--
-- Target format:
--   chat_id = "user:{userId}"       → unified, channel-agnostic

-- ============================================================
-- Step 1: Diagnostic — show current session tags per instance
-- ============================================================
SELECT instance_id, chat_id, COUNT(*) as msg_count
FROM memories
GROUP BY instance_id, chat_id
ORDER BY instance_id, msg_count DESC;

-- ============================================================
-- Step 2: Check for already-migrated entries
-- ============================================================
SELECT instance_id, chat_id, COUNT(*) as msg_count
FROM memories
WHERE chat_id LIKE 'user:%'
GROUP BY instance_id, chat_id;

-- ============================================================
-- Step 3: Template for each user mapping
-- ============================================================
-- Replace {NEW_USER_ID}, {INSTANCE_ID}, and {OLD_SESSION_TAG} with actual values.
--
-- UPDATE memories
--   SET chat_id = 'user:{NEW_USER_ID}'
--   WHERE instance_id = '{INSTANCE_ID}'
--     AND chat_id = '{OLD_SESSION_TAG}';
--
-- Example:
--   UPDATE memories
--     SET chat_id = 'user:abc-def-123'
--     WHERE instance_id = 'doudou'
--       AND chat_id = 'telegram:Scott';

-- ============================================================
-- Step 4: Verify migration
-- ============================================================
-- After running updates, re-run Step 1 to confirm all tags are now "user:*".
-- Any remaining legacy tags indicate unmapped users that need manual attention.
