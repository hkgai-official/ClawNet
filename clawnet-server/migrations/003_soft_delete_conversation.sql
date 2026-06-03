-- 003: 会话软删除支持
-- 在 conversation_participants 上增加 hidden_at 列
-- 用户「删除」会话时，只标记当前用户的 hidden_at，不影响其他参与者

ALTER TABLE conversation_participants
    ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ DEFAULT NULL;

-- hidden_at IS NOT NULL 表示该用户已「隐藏」此会话
-- 查询时过滤: WHERE hidden_at IS NULL
-- 当会话有新消息时，自动重置 hidden_at = NULL（让会话重新出现）

COMMENT ON COLUMN conversation_participants.hidden_at IS '用户隐藏会话的时间，NULL 表示可见';
