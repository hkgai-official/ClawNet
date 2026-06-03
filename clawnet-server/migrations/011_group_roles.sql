-- 011: Add role column to conversation_participants for group chat management
ALTER TABLE conversation_participants
ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'member';

-- Set existing conversation creators as owners
UPDATE conversation_participants cp
SET role = 'owner'
FROM conversations c
WHERE cp.conversation_id = c.id
  AND cp.participant_id = c.created_by
  AND cp.participant_type = 'human';
