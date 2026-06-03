-- ClawNet Agent Dialog Session Schema
-- Version: 1.1.0
-- Description: 支持 Agent-to-Agent 通信的对话会话管理

-- Agent Dialog Sessions table
-- 用于管理 Agent 间对话的会话状态
CREATE TABLE IF NOT EXISTS agent_dialog_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 复用现有会话
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    
    -- 参与方
    initiator_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    responder_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    initiator_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    responder_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 议题
    topic TEXT NOT NULL,
    
    -- 授权状态
    initiator_approved BOOLEAN NOT NULL DEFAULT FALSE,
    responder_approved BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- 会话控制
    -- status: pending_approval | active | paused | completed | terminated
    status VARCHAR(20) NOT NULL DEFAULT 'pending_approval',
    current_round INTEGER NOT NULL DEFAULT 0,
    max_rounds INTEGER NOT NULL DEFAULT 10,
    idle_timeout_seconds INTEGER NOT NULL DEFAULT 300,
    
    -- 终止信息
    -- termination_reason: resolved | deadlock | rounds_exceeded | owner_terminated | owner_rejected | timeout | agent_offline | nested_dialog
    termination_reason VARCHAR(30),
    
    -- 元数据（用于存储原始会话信息等）
    metadata JSONB,
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,           -- 双方都 approve 的时刻
    last_message_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- 约束
    CONSTRAINT check_different_agents CHECK (initiator_agent_id != responder_agent_id),
    CONSTRAINT check_valid_status CHECK (status IN ('pending_approval', 'active', 'paused', 'completed', 'terminated')),
    CONSTRAINT check_valid_termination_reason CHECK (
        termination_reason IS NULL OR 
        termination_reason IN ('resolved', 'deadlock', 'rounds_exceeded', 'owner_terminated', 'owner_rejected', 'timeout', 'agent_offline', 'nested_dialog')
    ),
    CONSTRAINT check_max_rounds_positive CHECK (max_rounds > 0),
    CONSTRAINT check_idle_timeout_positive CHECK (idle_timeout_seconds > 0)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_conversation ON agent_dialog_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_status ON agent_dialog_sessions(status);
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_initiator_agent ON agent_dialog_sessions(initiator_agent_id);
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_responder_agent ON agent_dialog_sessions(responder_agent_id);
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_initiator_owner ON agent_dialog_sessions(initiator_owner_id);
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_responder_owner ON agent_dialog_sessions(responder_owner_id);
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_created ON agent_dialog_sessions(created_at DESC);

-- Index for timeout cleanup task
CREATE INDEX IF NOT EXISTS idx_dialog_sessions_active_timeout ON agent_dialog_sessions(status, last_message_at)
    WHERE status = 'active';

-- Comments
COMMENT ON TABLE agent_dialog_sessions IS 'Agent-to-Agent 对话会话管理表';
COMMENT ON COLUMN agent_dialog_sessions.topic IS '对话的核心议题';
COMMENT ON COLUMN agent_dialog_sessions.initiator_approved IS '发起方 Owner 是否已授权';
COMMENT ON COLUMN agent_dialog_sessions.responder_approved IS '接收方 Owner 是否已授权';
COMMENT ON COLUMN agent_dialog_sessions.status IS '会话状态: pending_approval, active, paused, completed, terminated';
COMMENT ON COLUMN agent_dialog_sessions.current_round IS '当前对话轮数';
COMMENT ON COLUMN agent_dialog_sessions.max_rounds IS '最大对话轮数（Owner 发起时设定）';
COMMENT ON COLUMN agent_dialog_sessions.idle_timeout_seconds IS '空闲超时秒数';
COMMENT ON COLUMN agent_dialog_sessions.termination_reason IS '终止原因';
COMMENT ON COLUMN agent_dialog_sessions.started_at IS '双方都授权后开始的时刻';
