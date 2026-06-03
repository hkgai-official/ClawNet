-- 016_conversation_summary.sql
ALTER TABLE conversations ADD COLUMN summary TEXT;
ALTER TABLE conversations ADD COLUMN summary_version INTEGER NOT NULL DEFAULT 0;
