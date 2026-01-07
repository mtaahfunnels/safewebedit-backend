/**
 * Ghost API Integration - Content Management
 *
 * Ghost Admin API Documentation: https://ghost.org/docs/admin-api/
 * Authentication: Admin API Key (format: id:secret)
 *
 * Features:
 * - Connect Ghost sites with Admin API Key
 * - List all posts and pages
 * - Edit post/page content
 * - Disconnect sites
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../../services/database');
const jwt = require('jsonwebtoken');

/**
 * Encrypt sensitive data (Ghost API keys)
 */
function encrypt(text) {
  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(process.env.ENCRYPTION_KEY || 'defaultkey12345678901234567890', 'utf8');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt sensitive data
 */
function decrypt(text) {
  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(process.env.ENCRYPTION_KEY || 'defaultkey12345678901234567890', 'utf8');
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generate Ghost Admin API JWT token
 * Ghost uses JWT tokens for authentication
 */
function generateGhostToken(apiKey) {
  const [id, secret] = apiKey.split(':');

  // Create token valid for 5 minutes
  const token = jwt.sign(
    {},
    Buffer.from(secret, 'hex'),
    {
      keyid: id,
      algorithm: 'HS256',
      expiresIn: '5m',
      audience: '/admin/'
    }
  );

  return token;
}

/**
 * Make authenticated request to Ghost Admin API
 */
async function makeGhostRequest(siteUrl, apiKey, endpoint, method = 'GET', body = null) {
  const token = generateGhostToken(apiKey);
  const url = `${siteUrl}/ghost/api/admin${endpoint}`;

  const options = {
    method,
    headers: {
      'Authorization': `Ghost ${token}`,
      'Content-Type': 'application/json'
    }
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ghost API error: ${response.status} - ${error}`);
  }

  return await response.json();
}

/**
 * POST /api/ghost/connect
 * Connect a Ghost site with Admin API Key
 */
router.post('/connect', async (req, res) => {
  try {
    const { site_url, site_name, admin_api_key } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Decode JWT to get organization_id
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const organizationId = decoded.organization_id;

    // Validate Ghost site by making test request
    console.log('[Ghost] Testing connection to:', site_url);

    try {
      await makeGhostRequest(site_url, admin_api_key, '/site/', 'GET');
    } catch (error) {
      console.error('[Ghost] Connection test failed:', error);
      return res.status(400).json({
        error: 'Failed to connect to Ghost site. Please check your site URL and Admin API Key.'
      });
    }

    // Encrypt the API key
    const encryptedKey = encrypt(admin_api_key);

    // Store in database
    const result = await db.query(`
      INSERT INTO wordpress_sites (
        organization_id,
        site_url,
        site_name,
        wp_username,
        wp_app_password_encrypted,
        platform,
        is_connected,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (organization_id, site_url)
      DO UPDATE SET
        site_name = EXCLUDED.site_name,
        wp_app_password_encrypted = EXCLUDED.wp_app_password_encrypted,
        is_connected = true,
        platform = 'ghost',
        updated_at = NOW()
      RETURNING id, site_url, site_name, platform, created_at
    `, [
      organizationId,
      site_url,
      site_name || new URL(site_url).hostname,
      'ghost_admin', // wp_username field used for identification
      encryptedKey,
      'ghost',
      true
    ]);

    const site = result.rows[0];
    console.log('[Ghost] Site connected successfully:', site.id);

    res.json({
      success: true,
      message: 'Ghost site connected successfully',
      site: {
        id: site.id,
        url: site.site_url,
        name: site.site_name,
        platform: site.platform,
        created_at: site.created_at
      }
    });
  } catch (error) {
    console.error('[Ghost Connect] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ghost/sites
 * Get all connected Ghost sites for current organization
 */
router.get('/sites', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const organizationId = decoded.organization_id;

    const result = await db.query(`
      SELECT id, site_url, site_name, platform, is_connected, created_at
      FROM wordpress_sites
      WHERE organization_id = $1 AND platform = 'ghost'
      ORDER BY created_at DESC
    `, [organizationId]);

    res.json({
      success: true,
      sites: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('[Ghost Sites] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ghost/posts/:siteId
 * Get all posts and pages from a Ghost site
 */
router.get('/posts/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get site credentials from database
    const siteResult = await db.query(`
      SELECT site_url, wp_app_password_encrypted
      FROM wordpress_sites
      WHERE id = $1 AND platform = 'ghost'
    `, [siteId]);

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ghost site not found' });
    }

    const { site_url, wp_app_password_encrypted } = siteResult.rows[0];
    const apiKey = decrypt(wp_app_password_encrypted);

    // Get posts and pages
    const postsData = await makeGhostRequest(
      site_url,
      apiKey,
      '/posts/?limit=all&formats=mobiledoc,html',
      'GET'
    );

    const pagesData = await makeGhostRequest(
      site_url,
      apiKey,
      '/pages/?limit=all&formats=mobiledoc,html',
      'GET'
    );

    // Combine posts and pages
    const allContent = [
      ...postsData.posts.map(p => ({ ...p, type: 'post' })),
      ...pagesData.pages.map(p => ({ ...p, type: 'page' }))
    ];

    res.json({
      success: true,
      content: allContent,
      total: allContent.length
    });
  } catch (error) {
    console.error('[Ghost Posts] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/ghost/posts/:siteId/:postId
 * Update a post or page in Ghost site
 */
router.put('/posts/:siteId/:postId', async (req, res) => {
  try {
    const { siteId, postId } = req.params;
    const { html, type } = req.body; // type: 'post' or 'page'
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get site credentials from database
    const siteResult = await db.query(`
      SELECT site_url, wp_app_password_encrypted
      FROM wordpress_sites
      WHERE id = $1 AND platform = 'ghost'
    `, [siteId]);

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Ghost site not found' });
    }

    const { site_url, wp_app_password_encrypted } = siteResult.rows[0];
    const apiKey = decrypt(wp_app_password_encrypted);

    // Update post or page
    const endpoint = type === 'page' ? `/pages/${postId}/` : `/posts/${postId}/`;
    const updateData = await makeGhostRequest(
      site_url,
      apiKey,
      endpoint,
      'PUT',
      {
        [type === 'page' ? 'pages' : 'posts']: [{
          html: html,
          updated_at: new Date().toISOString()
        }]
      }
    );

    res.json({
      success: true,
      [type === 'page' ? 'page' : 'post']: updateData[type === 'page' ? 'pages' : 'posts'][0]
    });
  } catch (error) {
    console.error('[Ghost Update Post] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/ghost/sites/:siteId
 * Disconnect a Ghost site
 */
router.delete('/sites/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await db.query(`
      DELETE FROM wordpress_sites
      WHERE id = $1 AND platform = 'ghost'
    `, [siteId]);

    res.json({
      success: true,
      message: 'Ghost site disconnected successfully'
    });
  } catch (error) {
    console.error('[Ghost Disconnect] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
