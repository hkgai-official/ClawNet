-- Add optimistic locking version column to agent_dialog_sessions
-- Used to prevent race conditions between concurrent state modifications

ALTER TABLE agent_dialog_sessions
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN agent_dialog_sessions.version IS '乐观锁版本号，每次状态变更时递增，防止并发修改竞态';
