-- migrations/013_split_default_main.sql
-- Split the combined default+main tag into two separate tags.
-- Before: one tag per user with is_default=TRUE, is_main=TRUE
-- After: two tags per user — default (is_default=TRUE, is_main=FALSE) + main (is_default=FALSE, is_main=TRUE)

-- Step 1: Unset is_default on current combined tags (they become main-only)
-- Guard: only act on users who don't already have a separate main tag
UPDATE tags SET is_default = FALSE, name = 'main', display_name = 'Main Assistant', workspace_id = 'main'
WHERE is_default = TRUE AND is_main = TRUE
AND NOT EXISTS (
    SELECT 1 FROM tags t2 WHERE t2.owner_id = tags.owner_id AND t2.is_main = TRUE AND t2.is_default = FALSE
);

-- Step 2: Create new default tags for each user who has a main tag but no default tag
-- Uses a subquery to find users with main but without default
INSERT INTO tags (id, owner_id, name, display_name, is_default, is_main, workspace_id, node_acl, created_at, updated_at)
SELECT
    gen_random_uuid(),
    t.owner_id,
    'default',
    'Default',
    TRUE,
    FALSE,
    'default',
    '{"allowed_paths": [], "denied_paths": []}',
    NOW(),
    NOW()
FROM tags t
WHERE t.is_main = TRUE
AND NOT EXISTS (
    SELECT 1 FROM tags t2 WHERE t2.owner_id = t.owner_id AND t2.is_default = TRUE AND t2.is_main = FALSE
);
