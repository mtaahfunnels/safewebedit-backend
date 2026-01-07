-- Google Sheets Integration Migration
-- Adds support for service account-based Google Sheets syncing

-- Add Google Sheets configuration to organizations table
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS google_sheet_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS google_sheet_url TEXT,
  ADD COLUMN IF NOT EXISTS google_sheet_range VARCHAR(100) DEFAULT 'Sheet1!A:Z',
  ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_organizations_google_sheet
  ON organizations(google_sheet_id)
  WHERE google_sheet_id IS NOT NULL;

-- Create index for sync monitoring
CREATE INDEX IF NOT EXISTS idx_organizations_sync_enabled
  ON organizations(sync_enabled)
  WHERE sync_enabled = TRUE;

COMMENT ON COLUMN organizations.google_sheet_id IS 'Extracted ID from Google Sheets URL';
COMMENT ON COLUMN organizations.google_sheet_url IS 'Full Google Sheets URL provided by user';
COMMENT ON COLUMN organizations.google_sheet_range IS 'Sheet range in A1 notation (default: Sheet1!A:Z)';
COMMENT ON COLUMN organizations.sync_enabled IS 'Whether automatic syncing is enabled';
COMMENT ON COLUMN organizations.last_synced_at IS 'Timestamp of last successful sync';
