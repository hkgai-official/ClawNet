-- 004: 消息软删除支持
-- 新建 message_hidden 表，记录用户对消息的隐藏关系
-- 用户「删除」消息时，只插入一条 hidden 记录，不影响其他用户

CREATE TABLE IF NOT EXISTS message_hidden (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_hidden_user ON message_hidden(user_id);
