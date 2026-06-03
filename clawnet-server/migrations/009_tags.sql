-- 009_tags.sql: Tag-based social identity system

-- 1. Create tags table
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    icon VARCHAR(16),
    color VARCHAR(16),
    is_default BOOLEAN NOT NULL DEFAULT false,
    workspace_id VARCHAR(64) NOT NULL,
    node_acl JSONB NOT NULL DEFAULT '{"allowed_paths": [], "denied_paths": []}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(owner_id, name),
    UNIQUE(owner_id, workspace_id)
);

CREATE INDEX idx_tags_owner_id ON tags(owner_id);

-- 2. Add tag_id to agents
ALTER TABLE agents ADD COLUMN tag_id UUID REFERENCES tags(id) ON DELETE SET NULL;
CREATE INDEX idx_agents_tag_id ON agents(tag_id);

-- 3. Add tag_id to contacts
ALTER TABLE contacts ADD COLUMN tag_id UUID REFERENCES tags(id) ON DELETE SET NULL;
CREATE INDEX idx_contacts_tag_id ON contacts(tag_id);

-- 4. Create default tags for existing users
INSERT INTO tags (owner_id, name, display_name, is_default, workspace_id, node_acl)
SELECT id, 'default', '默认', true, 'default', '{"allowed_paths": [], "denied_paths": []}'::jsonb
FROM users;
