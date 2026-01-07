/**
 * Database Service - PostgreSQL Connection
 * Handles all database operations for SafeWebEdits
 */

const { Pool } = require('pg');

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://safewebedits_user:SafeWeb2026!Edits@localhost:5432/safewebedits_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Helper function to execute queries
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('[DB]', { query: text.substring(0, 80), duration, rows: res.rowCount });
  return res;
}

// ===========================================
// ORGANIZATIONS
// ===========================================
const organizations = {
  async create(orgData) {
    const { name, slug, email, password_hash, organization_type, content_tone, keycloak_id } = orgData;
    const text = `
      INSERT INTO organizations (name, slug, email, password_hash, organization_type, content_tone, keycloak_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, slug, email, organization_type, content_tone, keycloak_id, created_at
    `;
    const values = [name, slug, email, password_hash, organization_type || 'business', content_tone || 'professional', keycloak_id];
    const res = await query(text, values);
    return res.rows[0];
  },

  async findByEmail(email) {
    const text = 'SELECT * FROM organizations WHERE email = $1';
    const res = await query(text, [email]);
    return res.rows[0] || null;
  },

  async findAllByEmail(email) {
    const text = 'SELECT * FROM organizations WHERE email = $1 ORDER BY created_at DESC';
    const res = await query(text, [email]);
    return res.rows;
  },

  async findById(id) {
    const text = 'SELECT * FROM organizations WHERE id = $1';
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  async update(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(updates[key]);
        paramIndex++;
      }
    });

    if (fields.length === 0) return null;

    values.push(id);
    const text = `
      UPDATE organizations
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    const res = await query(text, values);
    return res.rows[0];
  },

  async delete(id) {
    const text = 'DELETE FROM organizations WHERE id = $1 RETURNING *';
    const res = await query(text, [id]);
    return res.rows[0];
  },
};

// ===========================================
// WORDPRESS SITES
// ===========================================
const wordpressSites = {
  async create(siteData) {
    const { organization_id, site_url, site_name, wp_username, wp_app_password_encrypted } = siteData;
    const text = `
      INSERT INTO wordpress_sites (organization_id, site_url, site_name, wp_username, wp_app_password_encrypted, is_connected)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING *
    `;
    const values = [organization_id, site_url, site_name, wp_username, wp_app_password_encrypted];
    const res = await query(text, values);
    return res.rows[0];
  },

  async findByOrganization(organization_id) {
    const text = 'SELECT * FROM wordpress_sites WHERE organization_id = $1 ORDER BY created_at DESC';
    const res = await query(text, [organization_id]);
    return res.rows;
  },

  async findById(id) {
    const text = 'SELECT * FROM wordpress_sites WHERE id = $1';
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  async update(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(updates[key]);
        paramIndex++;
      }
    });

    if (fields.length === 0) return null;

    values.push(id);
    const text = `
      UPDATE wordpress_sites
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    const res = await query(text, values);
    return res.rows[0];
  },

  async updatePages(id, pages) {
    const text = 'UPDATE wordpress_sites SET available_pages = $2, last_verified_at = NOW() WHERE id = $1';
    await query(text, [id, JSON.stringify(pages)]);
  },

  async updatePosts(id, posts) {
    const text = 'UPDATE wordpress_sites SET available_posts = $2, last_verified_at = NOW() WHERE id = $1';
    await query(text, [id, JSON.stringify(posts)]);
  },
  async delete(id) {
    const text = 'DELETE FROM wordpress_sites WHERE id = $1 RETURNING *';
    const res = await query(text, [id]);
    return res.rows[0];
  },
};

// ===========================================
// UNIVERSAL SITES (NEW - Playwright-based)
// ===========================================
const universalSites = {
  async create(organizationId, siteData) {
    const { url, name, authType, credentials } = siteData;
    const text = `
      INSERT INTO universal_sites (organization_id, site_url, site_name, auth_type, credentials_encrypted)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [
      organizationId,
      url,
      name || url,
      authType || 'none',
      credentials ? JSON.stringify(credentials) : '{}'
    ];
    const res = await query(text, values);
    return res.rows[0];
  },

  async findByOrganization(organizationId) {
    const text = 'SELECT * FROM universal_sites WHERE organization_id = $1 ORDER BY created_at DESC';
    const res = await query(text, [organizationId]);
    return res.rows;
  },

  async findById(id) {
    const text = 'SELECT * FROM universal_sites WHERE id = $1';
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  async findByUrl(organizationId, siteUrl) {
    const text = 'SELECT * FROM universal_sites WHERE organization_id = $1 AND site_url = $2';
    const res = await query(text, [organizationId, siteUrl]);
    return res.rows[0] || null;
  },

  async updateConnectionStatus(id, isConnected, error = null) {
    const text = `
      UPDATE universal_sites
      SET is_connected = $1, last_verified_at = NOW(), connection_error = $2
      WHERE id = $3
      RETURNING *
    `;
    const res = await query(text, [isConnected, error, id]);
    return res.rows[0];
  },

  async updateDetectedSections(id, sections) {
    const text = `
      UPDATE universal_sites
      SET detected_sections = $2, last_verified_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const res = await query(text, [id, JSON.stringify(sections)]);
    return res.rows[0];
  },

  async updatePageMetadata(id, metadata) {
    const text = `
      UPDATE universal_sites
      SET page_metadata = $2
      WHERE id = $1
      RETURNING *
    `;
    const res = await query(text, [id, JSON.stringify(metadata)]);
    return res.rows[0];
  },

  async update(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) {
        // Handle JSONB fields
        if (['credentials_encrypted', 'detected_sections', 'page_metadata'].includes(key) && typeof updates[key] === 'object') {
          fields.push(`${key} = $${paramIndex}`);
          values.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = $${paramIndex}`);
          values.push(updates[key]);
        }
        paramIndex++;
      }
    });

    if (fields.length === 0) return null;

    values.push(id);
    const text = `
      UPDATE universal_sites
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    const res = await query(text, values);
    return res.rows[0];
  },

  async delete(id) {
    const text = 'DELETE FROM universal_sites WHERE id = $1 RETURNING *';
    const res = await query(text, [id]);
    return res.rows[0];
  },
};

// ===========================================
// CONTENT SLOTS
// ===========================================
const contentSlots = {
  async create(slotData) {
    const { wordpress_site_id, universal_site_id, wp_page_id, slot_name, slot_label, marker_name, description, slot_type, css_selector, section_type } = slotData;
    const text = `
      INSERT INTO content_slots (wordpress_site_id, universal_site_id, wp_page_id, slot_name, slot_label, marker_name, description, slot_type, css_selector, section_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const values = [
      wordpress_site_id || null,
      universal_site_id || null,
      wp_page_id,
      slot_name,
      slot_label,
      marker_name,
      description,
      slot_type || 'html_marker',
      css_selector || null,
      section_type || null
    ];
    const res = await query(text, values);
    return res.rows[0];
  },

  async findBySite(wordpress_site_id) {
    const text = 'SELECT * FROM content_slots WHERE wordpress_site_id = $1 ORDER BY created_at DESC';
    const res = await query(text, [wordpress_site_id]);
    return res.rows;
  },

  async findByUniversalSite(universal_site_id) {
    const text = 'SELECT * FROM content_slots WHERE universal_site_id = $1 ORDER BY created_at DESC';
    const res = await query(text, [universal_site_id]);
    return res.rows;
  },

  async findById(id) {
    const text = 'SELECT * FROM content_slots WHERE id = $1';
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  async update(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(updates[key]);
        paramIndex++;
      }
    });

    if (fields.length === 0) return null;

    values.push(id);
    const text = `
      UPDATE content_slots
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    const res = await query(text, values);
    return res.rows[0];
  },

  async delete(id) {
    const text = 'DELETE FROM content_slots WHERE id = $1 RETURNING *';
    const res = await query(text, [id]);
    return res.rows[0];
  },
};

// ===========================================
// CONTENT UPDATES
// ===========================================
const contentUpdates = {
  async create(updateData) {
    const { organization_id, wordpress_site_id, universal_site_id, content_slot_id, update_instructions, generated_content, wp_content_type } = updateData;
    const text = `
      INSERT INTO content_updates (organization_id, wordpress_site_id, universal_site_id, content_slot_id, update_instructions, generated_content, wp_content_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      organization_id,
      wordpress_site_id || null,
      universal_site_id || null,
      content_slot_id,
      update_instructions,
      generated_content,
      wp_content_type
    ];
    const res = await query(text, values);
    return res.rows[0];
  },

  async findByOrganization(organization_id, limit = 20) {
    const text = `
      SELECT cu.*,
             ws.site_name as wp_site_name, ws.site_url as wp_site_url,
             us.site_name as universal_site_name, us.site_url as universal_site_url,
             cs.slot_name
      FROM content_updates cu
      LEFT JOIN wordpress_sites ws ON cu.wordpress_site_id = ws.id
      LEFT JOIN universal_sites us ON cu.universal_site_id = us.id
      LEFT JOIN content_slots cs ON cu.content_slot_id = cs.id
      WHERE cu.organization_id = $1
      ORDER BY cu.created_at DESC
      LIMIT $2
    `;
    const res = await query(text, [organization_id, limit]);
    return res.rows;
  },

  async findById(id) {
    const text = 'SELECT * FROM content_updates WHERE id = $1';
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  async update(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${paramIndex}`);
        values.push(updates[key]);
        paramIndex++;
      }
    });

    if (fields.length === 0) return null;

    values.push(id);
    const text = `
      UPDATE content_updates
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    const res = await query(text, values);
    return res.rows[0];
  },

  async delete(id) {
    const text = 'DELETE FROM content_updates WHERE id = $1 RETURNING *';
    const res = await query(text, [id]);
    return res.rows[0];
  },
};

// ===========================================
// SUBSCRIPTIONS
// ===========================================
const subscriptions = {
  async findByOrganization(organization_id) {
    const text = 'SELECT * FROM subscriptions WHERE organization_id = $1';
    const res = await query(text, [organization_id]);
    return res.rows[0] || null;
  },

  async getUsage(organization_id) {
    const text = `
      SELECT
        s.plan_name,
        s.is_unlimited,
        s.monthly_update_limit as monthly_limit,
        COALESCE(s.updates_this_month, 0) as updates_this_month,
        CASE
          WHEN s.is_unlimited THEN 999999
          ELSE s.monthly_update_limit - COALESCE(s.updates_this_month, 0)
        END as remaining,
        CASE
          WHEN s.is_unlimited THEN false
          ELSE COALESCE(s.updates_this_month, 0) >= s.monthly_update_limit
        END as limit_reached
      FROM subscriptions s
      WHERE s.organization_id = $1
    `;
    const res = await query(text, [organization_id]);
    return res.rows[0] || null;
  },

  async incrementUsage(organization_id) {
    const text = `
      UPDATE subscriptions
      SET updates_this_month = COALESCE(updates_this_month, 0) + 1
      WHERE organization_id = $1
      RETURNING *
    `;
    const res = await query(text, [organization_id]);
    return res.rows[0];
  },
};


// ===========================================
// PASSWORD RESET TOKENS
// ===========================================
const passwordResetTokens = {
  async create(organizationId) {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const text = `
      INSERT INTO password_reset_tokens (organization_id, token, expires_at)
      VALUES ($1, $2, $3)
      RETURNING token, expires_at
    `;
    const res = await query(text, [organizationId, token, expiresAt]);
    return res.rows[0];
  },

  async findValidToken(token) {
    const text = `
      SELECT prt.*, o.email
      FROM password_reset_tokens prt
      JOIN organizations o ON prt.organization_id = o.id
      WHERE prt.token = $1
        AND prt.used = FALSE
        AND prt.expires_at > NOW()
    `;
    const res = await query(text, [token]);
    return res.rows[0] || null;
  },

  async markAsUsed(token) {
    const text = `UPDATE password_reset_tokens SET used = TRUE WHERE token = $1`;
    await query(text, [token]);
  },

  async invalidateAllForOrganization(organizationId) {
    const text = `UPDATE password_reset_tokens SET used = TRUE WHERE organization_id = $1 AND used = FALSE`;
    await query(text, [organizationId]);
  },
};

module.exports = {
  query,
  organizations,
  wordpressSites,
  universalSites,     // NEW: Universal platform support
  contentSlots,
  contentUpdates,
  subscriptions,
  passwordResetTokens,
};
