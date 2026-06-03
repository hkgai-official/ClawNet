-- 010_agent_tag_role.sql
-- Add tag_role column to agents table.
-- Values: 'owner' (direct user chat, rw), 'delegate' (A2A dialog, ro), NULL (legacy/unassigned).

ALTER TABLE agents ADD COLUMN tag_role VARCHAR(20) DEFAULT NULL;

-- Index for efficient routing: find agent by (owner_id, tag_id, tag_role)
CREATE INDEX idx_agents_owner_tag_role ON agents (owner_id, tag_id, tag_role)
    WHERE tag_id IS NOT NULL AND tag_role IS NOT NULL;
