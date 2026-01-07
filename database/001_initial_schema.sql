-- =====================================================
-- SAFEWEBEDITS - INITIAL SCHEMA
-- =====================================================
-- Migration: 001
-- Description: Core tables for multi-vertical content automation platform
-- Date: 2026-01-01
-- =====================================================

-- =====================================================
-- ORGANIZATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Basic info
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,

  -- Organization type (vertical)
  organization_type VARCHAR(50) DEFAULT 'business',
  industry VARCHAR(100),

  -- Settings
  content_tone VARCHAR(50) DEFAULT 'professional',
  timezone VARCHAR(50) DEFAULT 'America/New_York',

  -- Subscription
  subscription_status VARCHAR(50) DEFAULT 'free',

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  email_verified BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(organization_type);
CREATE INDEX IF NOT EXISTS idx_organizations_email ON organizations(email);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- =====================================================
-- WORDPRESS_SITES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS wordpress_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Connection details
  site_url VARCHAR(500) NOT NULL,
  site_name VARCHAR(255),
  wp_username VARCHAR(255) NOT NULL,
  wp_app_password_encrypted TEXT NOT NULL,

  -- Status
  is_connected BOOLEAN DEFAULT FALSE,
  last_verified_at TIMESTAMPTZ,
  connection_error TEXT,

  -- Cached WordPress data
  available_pages JSONB DEFAULT '[]'::jsonb,
  available_posts JSONB DEFAULT '[]'::jsonb,
  wp_version VARCHAR(50),
  theme_name VARCHAR(255),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, site_url)
);

CREATE INDEX IF NOT EXISTS idx_wp_sites_org ON wordpress_sites(organization_id);
CREATE INDEX IF NOT EXISTS idx_wp_sites_connected ON wordpress_sites(is_connected);

-- =====================================================
-- CONTENT_SLOTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS content_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wordpress_site_id UUID NOT NULL REFERENCES wordpress_sites(id) ON DELETE CASCADE,

  -- Slot identification
  slot_name VARCHAR(100) NOT NULL,
  slot_label VARCHAR(255),
  description TEXT,

  -- WordPress location
  wp_page_id INTEGER NOT NULL,
  wp_page_title VARCHAR(500),

  -- Marker configuration
  marker_name VARCHAR(100) NOT NULL,
  slot_type VARCHAR(50) DEFAULT 'html_marker',

  -- Current state
  current_content TEXT,
  last_updated_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(wordpress_site_id, slot_name),
  UNIQUE(wordpress_site_id, wp_page_id, marker_name)
);

CREATE INDEX IF NOT EXISTS idx_slots_site_active ON content_slots(wordpress_site_id, is_active);
CREATE INDEX IF NOT EXISTS idx_slots_page ON content_slots(wp_page_id);

-- =====================================================
-- CONTENT_UPDATES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS content_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wordpress_site_id UUID NOT NULL REFERENCES wordpress_sites(id) ON DELETE CASCADE,
  content_slot_id UUID REFERENCES content_slots(id) ON DELETE SET NULL,

  -- WordPress content reference
  wp_content_id INTEGER,
  wp_content_type VARCHAR(50),

  -- Update details
  update_instructions TEXT NOT NULL,
  generated_content TEXT,

  -- Status
  status VARCHAR(50) DEFAULT 'generated',
  published_at TIMESTAMPTZ,
  error_message TEXT,

  -- Metadata
  wordpress_url VARCHAR(500),
  ai_model_used VARCHAR(100) DEFAULT 'llama-3.3-70b-versatile',
  generation_time_ms INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_updates_org ON content_updates(organization_id);
CREATE INDEX IF NOT EXISTS idx_updates_site ON content_updates(wordpress_site_id);
CREATE INDEX IF NOT EXISTS idx_updates_status ON content_updates(status);
CREATE INDEX IF NOT EXISTS idx_updates_created ON content_updates(created_at DESC);

-- =====================================================
-- SUBSCRIPTIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Plan details
  plan_name VARCHAR(100) DEFAULT 'free',
  is_unlimited BOOLEAN DEFAULT FALSE,
  monthly_update_limit INTEGER DEFAULT 5,

  -- Usage tracking
  updates_this_month INTEGER DEFAULT 0,
  billing_period_start DATE,
  billing_period_end DATE,

  -- Payment
  stripe_subscription_id VARCHAR(255),
  stripe_price_id VARCHAR(255),

  -- Status
  status VARCHAR(50) DEFAULT 'active',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organization_id);

-- =====================================================
-- PASSWORD_RESET_TOKENS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION check_usage_limit(org_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  sub RECORD;
BEGIN
  SELECT * INTO sub FROM subscriptions WHERE organization_id = org_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF sub.is_unlimited THEN
    RETURN TRUE;
  END IF;
  RETURN sub.updates_this_month < sub.monthly_update_limit;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_usage(org_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE subscriptions
  SET updates_this_month = updates_this_month + 1,
      updated_at = NOW()
  WHERE organization_id = org_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS VOID AS $$
BEGIN
  UPDATE subscriptions
  SET updates_this_month = 0,
      billing_period_start = DATE_TRUNC('month', CURRENT_DATE),
      billing_period_end = DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day',
      updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS
-- =====================================================

CREATE OR REPLACE FUNCTION create_default_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO subscriptions (
    organization_id,
    plan_name,
    is_unlimited,
    monthly_update_limit,
    billing_period_start,
    billing_period_end
  ) VALUES (
    NEW.id,
    'free',
    FALSE,
    5,
    DATE_TRUNC('month', CURRENT_DATE),
    DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_subscription ON organizations;
CREATE TRIGGER trigger_create_subscription
AFTER INSERT ON organizations
FOR EACH ROW
EXECUTE FUNCTION create_default_subscription();
