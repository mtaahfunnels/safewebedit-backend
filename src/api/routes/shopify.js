/**
 * Shopify OAuth Integration - Seamless 2-Click Setup
 *
 * Flow:
 * 1. User clicks "Connect Shopify" → Frontend redirects to /api/shopify/oauth/install
 * 2. Backend redirects to Shopify OAuth: shop.myshopify.com/admin/oauth/authorize
 * 3. User clicks "Install" on Shopify (one click)
 * 4. Shopify redirects back to /api/shopify/oauth/callback with code
 * 5. Backend exchanges code for access token
 * 6. Store encrypted token in database
 * 7. Redirect user back to dashboard with success message
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../../services/database');

// Shopify OAuth Configuration
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_API_VERSION = '2026-01';
const SHOPIFY_SCOPES = 'read_content,write_content,read_products,write_products';
const BACKEND_URL = process.env.BACKEND_URL || 'https://safewebedit.com';

/**
 * Encrypt sensitive data
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
 * Make authenticated request to Shopify API
 */
async function makeShopifyRequest(shopDomain, accessToken, endpoint, method = 'GET', body = null) {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;

  const options = {
    method,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Shopify API error: ${response.status} - ${error}`);
  }

  return await response.json();
}

/**
 * GET /api/shopify/oauth/install
 * Step 1: Initiate OAuth flow
 *
 * Frontend redirects here with shop domain
 * We redirect to Shopify's OAuth screen
 */
router.get('/oauth/install', async (req, res) => {
  try {
    const { shop, organization_id } = req.query;

    if (!shop) {
      return res.status(400).send('Missing shop parameter');
    }

    // Validate and normalize shop domain
    let shopDomain = shop.trim();
    if (!shopDomain.includes('.myshopify.com')) {
      shopDomain = `${shopDomain}.myshopify.com`;
    }

    console.log('[Shopify OAuth] Initiating install for shop:', shopDomain);

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in session/database for verification
    // For now, we'll include organization_id in state and verify later
    const stateData = {
      state: state,
      organization_id: organization_id,
      timestamp: Date.now()
    };

    // Store in temporary cache (you might want to use Redis for production)
    // For now, we'll encode it in the state parameter
    const encodedState = Buffer.from(JSON.stringify(stateData)).toString('base64');

    // Build OAuth URL
    const redirectUri = `${BACKEND_URL}/api/shopify/oauth/callback`;
    const oauthUrl = `https://${shopDomain}/admin/oauth/authorize?` +
      `client_id=${SHOPIFY_API_KEY}&` +
      `scope=${SHOPIFY_SCOPES}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${encodedState}`;

    console.log('[Shopify OAuth] Redirecting to:', oauthUrl);

    // Redirect user to Shopify OAuth screen
    res.redirect(oauthUrl);
  } catch (error) {
    console.error('[Shopify OAuth Install] Error:', error);
    res.status(500).send('Failed to initiate Shopify OAuth');
  }
});

/**
 * GET /api/shopify/oauth/callback
 * Step 2: Handle OAuth callback from Shopify
 *
 * Shopify redirects here after user clicks "Install"
 * We exchange the code for an access token
 */
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, shop, state } = req.query;

    console.log('[Shopify OAuth] Callback received for shop:', shop);

    if (!code || !shop || !state) {
      return res.status(400).send('Missing required OAuth parameters');
    }

    // Decode and verify state
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    } catch (err) {
      return res.status(400).send('Invalid state parameter');
    }

    // Verify state timestamp (prevent replay attacks)
    const stateAge = Date.now() - stateData.timestamp;
    if (stateAge > 10 * 60 * 1000) { // 10 minutes
      return res.status(400).send('OAuth state expired. Please try again.');
    }

    console.log('[Shopify OAuth] Exchanging code for access token...');

    // Exchange code for access token
    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[Shopify OAuth] Token exchange failed:', errorText);
      return res.status(400).send('Failed to exchange code for access token');
    }

    const { access_token } = await tokenResponse.json();
    console.log('[Shopify OAuth] Access token received');

    // Get shop info
    const shopInfo = await makeShopifyRequest(shop, access_token, '/shop.json', 'GET');
    console.log('[Shopify OAuth] Shop info retrieved:', shopInfo.shop.name);

    // Encrypt the access token
    const encryptedToken = encrypt(access_token);

    // Store in database
    const organizationId = stateData.organization_id;

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
        platform = 'shopify',
        updated_at = NOW()
      RETURNING id, site_url, site_name, platform, created_at
    `, [
      organizationId,
      `https://${shop}`,
      shopInfo.shop.name,
      shop,
      encryptedToken,
      'shopify',
      true
    ]);

    const site = result.rows[0];
    console.log('[Shopify OAuth] Store connected successfully:', site.id);

    // Redirect back to dashboard with success message
    const frontendUrl = process.env.FRONTEND_URL || 'https://safewebedit.com';
    res.redirect(`${frontendUrl}/dashboard/wordpress?shopify_connected=true&shop=${encodeURIComponent(shopInfo.shop.name)}`);
  } catch (error) {
    console.error('[Shopify OAuth Callback] Error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'https://safewebedit.com';
    res.redirect(`${frontendUrl}/dashboard/wordpress?error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * GET /api/shopify/sites
 * Get all connected Shopify stores for current organization
 */
router.get('/sites', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Decrypt JWT to get organization_id
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const organizationId = decoded.organization_id;

    const result = await db.query(`
      SELECT id, site_url, site_name, platform, is_connected, created_at
      FROM wordpress_sites
      WHERE organization_id = $1 AND platform = 'shopify'
      ORDER BY created_at DESC
    `, [organizationId]);

    res.json({
      success: true,
      sites: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('[Shopify Sites] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/shopify/pages/:siteId
 * Get all pages from a Shopify store
 */
router.get('/pages/:siteId', async (req, res) => {
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
      WHERE id = $1 AND platform = 'shopify'
    `, [siteId]);

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shopify store not found' });
    }

    const { site_url, wp_app_password_encrypted } = siteResult.rows[0];
    const accessToken = decrypt(wp_app_password_encrypted);
    const shopDomain = site_url.replace('https://', '');

    // Get pages from Shopify
    const pagesData = await makeShopifyRequest(shopDomain, accessToken, '/pages.json', 'GET');

    res.json({
      success: true,
      pages: pagesData.pages
    });
  } catch (error) {
    console.error('[Shopify Pages] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/shopify/pages/:siteId/:pageId
 * Update a page in Shopify store
 */
router.put('/pages/:siteId/:pageId', async (req, res) => {
  try {
    const { siteId, pageId } = req.params;
    const { body_html } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get site credentials from database
    const siteResult = await db.query(`
      SELECT site_url, wp_app_password_encrypted
      FROM wordpress_sites
      WHERE id = $1 AND platform = 'shopify'
    `, [siteId]);

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shopify store not found' });
    }

    const { site_url, wp_app_password_encrypted } = siteResult.rows[0];
    const accessToken = decrypt(wp_app_password_encrypted);
    const shopDomain = site_url.replace('https://', '');

    // Update page in Shopify
    const updateData = await makeShopifyRequest(
      shopDomain,
      accessToken,
      `/pages/${pageId}.json`,
      'PUT',
      { page: { body_html } }
    );

    res.json({
      success: true,
      page: updateData.page
    });
  } catch (error) {
    console.error('[Shopify Update Page] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/shopify/sites/:siteId
 * Disconnect a Shopify store
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
      WHERE id = $1 AND platform = 'shopify'
    `, [siteId]);

    res.json({
      success: true,
      message: 'Shopify store disconnected successfully'
    });
  } catch (error) {
    console.error('[Shopify Disconnect] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
