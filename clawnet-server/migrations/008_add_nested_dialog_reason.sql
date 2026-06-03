-- 008_add_nested_dialog_reason.sql
-- 更新 agent_dialog_sessions 的 termination_reason CHECK 约束，
-- 新增 'nested_dialog' 枚举值。
--
-- 背景：002_agent_dialog.sql 使用 CREATE TABLE IF NOT EXISTS，
-- 修改其中的 CHECK 约束不会在已有数据库上生效，需要 ALTER TABLE。

ALTER TABLE agent_dialog_sessions
  DROP CONSTRAINT IF EXISTS check_valid_termination_reason;

ALTER TABLE agent_dialog_sessions
  ADD CONSTRAINT check_valid_termination_reason CHECK (
    termination_reason IS NULL OR
    termination_reason IN (
      'resolved', 'deadlock', 'rounds_exceeded',
      'owner_terminated', 'owner_rejected',
      'timeout', 'agent_offline', 'nested_dialog'
    )
  );
