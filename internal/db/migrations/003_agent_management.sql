ALTER TABLE agent_runs ADD COLUMN agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs(agent_id);
