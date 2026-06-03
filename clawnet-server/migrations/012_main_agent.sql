-- migrations/012_main_agent.sql
-- Add is_main flag to tags for Main Agent identification
ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT FALSE;

-- Mark existing default tags as main (only if no main tag exists yet for that user)
UPDATE tags t SET is_main = TRUE
WHERE t.is_default = TRUE
AND NOT EXISTS (
    SELECT 1 FROM tags t2 WHERE t2.owner_id = t.owner_id AND t2.is_main = TRUE AND t2.id != t.id
);
