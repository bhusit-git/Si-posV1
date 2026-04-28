-- Add client_id column for idempotent transaction creation
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_id TEXT;

-- Add unique index for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_client_id ON transactions (client_id) WHERE client_id IS NOT NULL;
