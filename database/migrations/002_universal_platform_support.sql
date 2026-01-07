-- Migration: Universal Platform Support for SafeWebEdit
-- Description: Adds support for editing ANY website via Playwright browser automation
-- while maintaining 100% backwards compatibility with existing WordPress functionality
-- Date: 2026-01-03

-- =============================================================================
-- 1. NEW: universal_sites table for Playwright-based universal sites
-- =============================================================================

CREATE TABLE IF NOT EXISTS universal_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Site identification
  site_url VARCHAR(500) NOT NULL,
  site_name VARCHAR(255),

  -- Authentication (flexible for different auth types)
  auth_type VARCHAR(50) DEFAULT 'none', -- none, basic, session, custom
  credentials_encrypted JSONB DEFAULT '{}'::jsonb,

  -- Connection status
  is_connected BOOLEAN DEFAULT FALSE,
  last_verified_at TIMESTAMPTZ,
  connection_error TEXT,

  -- Playwright-detected sections (AI-powered)
  detected_sections JSONB DEFAULT '[]'::jsonb,
  page_metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, site_url)
);

CREATE INDEX idx_universal_sites_org ON universal_sites(organization_id);
CREATE INDEX idx_universal_sites_connected ON universal_sites(is_connected);

COMMENT ON TABLE universal_sites IS 'Stores universal website connections managed via Playwright browser automation';
COMMENT ON COLUMN universal_sites.auth_type IS 'Authentication method: none, basic, session, custom';
COMMENT ON COLUMN universal_sites.credentials_encrypted IS 'Encrypted credentials stored as JSONB';
COMMENT ON COLUMN universal_sites.detected_sections IS 'AI-detected editable sections from Playwright';

-- =============================================================================
-- 2. MODIFY: Add platform type tracking to existing wordpress_sites
-- =============================================================================

ALTER TABLE wordpress_sites
  ADD COLUMN IF NOT EXISTS platform_type VARCHAR(50) DEFAULT 'wordpress' NOT NULL;

CREATE INDEX idx_wp_sites_platform ON wordpress_sites(platform_type);

COMMENT ON COLUMN wordpress_sites.platform_type IS 'Platform identifier for unified site management';

-- =============================================================================
-- 3. MODIFY: Make content_slots polymorphic (support both WordPress and Universal)
-- =============================================================================

-- Add universal_site_id column
ALTER TABLE content_slots
  ADD COLUMN IF NOT EXISTS universal_site_id UUID REFERENCES universal_sites(id) ON DELETE CASCADE;

-- Make wordpress_site_id nullable (was previously NOT NULL)
ALTER TABLE content_slots
  ALTER COLUMN wordpress_site_id DROP NOT NULL;

-- Ensure one and only one site reference exists
ALTER TABLE content_slots
  ADD CONSTRAINT check_site_reference
  CHECK (
    (wordpress_site_id IS NOT NULL AND universal_site_id IS NULL) OR
    (wordpress_site_id IS NULL AND universal_site_id IS NOT NULL)
  );

CREATE INDEX idx_slots_universal_site ON content_slots(universal_site_id);

COMMENT ON COLUMN content_slots.universal_site_id IS 'Reference to universal_sites for non-WordPress sites';
COMMENT ON CONSTRAINT check_site_reference ON content_slots IS 'Ensures slot belongs to exactly one site (WordPress XOR Universal)';

-- =============================================================================
-- 4. MODIFY: Make content_updates polymorphic
-- =============================================================================

-- Add universal_site_id column
ALTER TABLE content_updates
  ADD COLUMN IF NOT EXISTS universal_site_id UUID REFERENCES universal_sites(id) ON DELETE CASCADE;

-- Make wordpress_site_id nullable
ALTER TABLE content_updates
  ALTER COLUMN wordpress_site_id DROP NOT NULL;

-- Ensure one and only one site reference exists
ALTER TABLE content_updates
  ADD CONSTRAINT check_update_site_reference
  CHECK (
    (wordpress_site_id IS NOT NULL AND universal_site_id IS NULL) OR
    (wordpress_site_id IS NULL AND universal_site_id IS NOT NULL)
  );

CREATE INDEX idx_updates_universal_site ON content_updates(universal_site_id);

COMMENT ON COLUMN content_updates.universal_site_id IS 'Reference to universal_sites for non-WordPress updates';
COMMENT ON CONSTRAINT check_update_site_reference ON content_updates IS 'Ensures update belongs to exactly one site (WordPress XOR Universal)';

-- =============================================================================
-- 5. NEW: page_snapshots table for Playwright session state
-- =============================================================================

CREATE TABLE IF NOT EXISTS page_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  universal_site_id UUID NOT NULL REFERENCES universal_sites(id) ON DELETE CASCADE,
  page_url VARCHAR(512) NOT NULL,
  html_content TEXT,
  screenshot_path VARCHAR(500),
  created_by UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_snapshots_site_page ON page_snapshots(universal_site_id, page_url);
CREATE INDEX idx_snapshots_created ON page_snapshots(created_at);

COMMENT ON TABLE page_snapshots IS 'Stores page snapshots from Playwright sessions for version control and rollback';
COMMENT ON COLUMN page_snapshots.html_content IS 'Full HTML content at time of snapshot';
COMMENT ON COLUMN page_snapshots.screenshot_path IS 'File path to visual screenshot of page';
COMMENT ON COLUMN page_snapshots.metadata IS 'Additional snapshot metadata (viewport, user agent, etc)';

-- =============================================================================
-- 6. VERIFICATION QUERIES (commented out - for manual testing)
-- =============================================================================

-- Verify existing WordPress sites are unaffected:
-- SELECT id, organization_id, site_url, platform_type FROM wordpress_sites;

-- Verify content_slots still reference WordPress sites correctly:
-- SELECT id, wordpress_site_id, universal_site_id FROM content_slots LIMIT 5;

-- Verify constraints work (should fail with both IDs):
-- INSERT INTO content_slots (wordpress_site_id, universal_site_id, ...) VALUES ('uuid1', 'uuid2', ...);

-- Verify constraints work (should fail with neither ID):
-- INSERT INTO content_slots (...) VALUES (...); -- omitting both site IDs

-- =============================================================================
-- Migration Complete
-- =============================================================================
-- This migration adds universal platform support while maintaining 100%
-- backwards compatibility with existing WordPress functionality.
-- No existing data is modified or deleted.
-- All WordPress sites continue to work exactly as before.
-- =============================================================================
