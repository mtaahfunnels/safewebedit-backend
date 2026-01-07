/**
 * WordPress Routes
 * Handles WordPress site connection and management
 * Enhanced with WooCommerce and Media Library endpoints
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');
const db = require('../../services/database');
const WordPressClient = require('../../services/wordpress');
const SectionDetector = require('../../services/sectionDetector');
const VisualAnalyzer = require('../../services/visualAnalyzer');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Simple encryption for app passwords (in production, use proper encryption)
function encryptPassword(password) {
  // For MVP, we'll use base64 encoding
  // TODO: Use proper encryption like AES-256 in production
  return Buffer.from(password).toString('base64');
}

function decryptPassword(encrypted) {
  return Buffer.from(encrypted, 'base64').toString('utf-8');
}

// ===========================================
// POST /api/wordpress/connect
// Connect and verify a WordPress site
// ===========================================
router.post('/connect', authenticateToken, async (req, res) => {
  console.log("[WP] Connect request body:", req.body);
  try {
    const { site_url, site_name, wp_username, wp_app_password } = req.body;
    const organizationId = req.organizationId;

    // Validation
    if (!site_url || !wp_username || !wp_app_password) {
      return res.status(400).json({
        error: 'site_url, wp_username, and wp_app_password are required',
      });
    }

    // Normalize URL (remove trailing slash for comparison)
    const normalizedUrl = site_url.replace(/\/$/, '');

    // Check if site already exists
    const existingCheck = await db.query(
      'SELECT id, site_name, site_url FROM wordpress_sites WHERE organization_id = $1 AND (site_url = $2 OR site_url = $3)',
      [organizationId, normalizedUrl, normalizedUrl + '/']
    );

    if (existingCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'This WordPress site is already connected to your account',
        details: existingCheck.rows[0].site_name || existingCheck.rows[0].site_url
      });
    }

    // Create WordPress client and verify connection
    const wpClient = new WordPressClient(site_url, wp_username, wp_app_password);
    const verification = await wpClient.verifyConnection();

    if (!verification.success) {
      console.log("[WP] Connection verification failed:", verification);
      return res.status(400).json({
        error: 'Failed to connect to WordPress site',
        details: verification.error,
      });
    }

    console.log('[WP] Connection verified:', {
      site: site_url,
      wp_version: verification.wp_version,
      user: verification.user_name,
      woocommerce: verification.has_woocommerce,
    });

    // Encrypt app password before storing
    const encrypted_password = encryptPassword(wp_app_password);

    // Save to database
    const wordpressSite = await db.wordpressSites.create({
      organization_id: organizationId,
      site_url: normalizedUrl,
      site_name: site_name || verification.site_name,
      wp_username: wp_username,
      wp_app_password_encrypted: encrypted_password,
    });

    // Fetch pages (optional - in background)
    const pagesResult = await wpClient.fetchPages();
    if (pagesResult.success) {
      await db.wordpressSites.updatePages(wordpressSite.id, pagesResult.pages);
    }

    // Fetch posts (optional - in background)
    const postsResult = await wpClient.fetchPosts();
    if (postsResult.success) {
      await db.wordpressSites.updatePosts(wordpressSite.id, postsResult.posts);
    }

    res.json({
      success: true,
      message: 'WordPress site connected successfully',
      site: {
        id: wordpressSite.id,
        site_url: wordpressSite.site_url,
        site_name: wordpressSite.site_name,
        has_woocommerce: verification.has_woocommerce,
      },
    });
  } catch (error) {
    console.error('[WP] Connect site error:', error);
    
    // Check if it's a duplicate key error (fallback if pre-check missed it)
    if (error.code === '23505' && error.constraint && error.constraint.includes('site_url')) {
      return res.status(409).json({
        error: 'This WordPress site is already connected to your account'
      });
    }
    
    res.status(500).json({ error: 'Failed to connect WordPress site' });
  }
});
// List all WordPress sites for an organization
// ===========================================
router.get('/sites', authenticateToken, async (req, res) => {
  try {
    console.log("[WP Sites] Organization ID:", req.organizationId);
    const sites = await db.wordpressSites.findByOrganization(req.organizationId);

    res.json({
      sites: sites.map(site => ({
        id: site.id,
        url: site.site_url,
        name: site.site_name,
        is_active: site.is_connected,
        last_synced_at: site.last_verified_at,
        pages_count: Array.isArray(site.available_pages) ? site.available_pages.length : 0,
        created_at: site.created_at,
      })),
      total: sites.length,
    });
  } catch (error) {
    console.error('[WP] List sites error:', error);
    res.status(500).json({ error: 'Failed to fetch WordPress sites' });
  }
});

// ===========================================
// GET /api/wordpress/sites/:siteId
// Get specific WordPress site details
// ===========================================
router.get('/sites/:siteId', authenticateToken, async (req, res) => {
  try {
    const site = await db.wordpressSites.findById(req.params.siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      site: {
        id: site.id,
        site_url: site.site_url,
        site_name: site.site_name,
        is_active: site.is_connected,
        last_synced_at: site.last_verified_at,
        available_pages: site.available_pages || [],
        available_posts: site.available_posts || [],
        wp_version: site.wp_version,
        theme_name: site.theme_name,
        created_at: site.created_at,
      },
    });
  } catch (error) {
    console.error('[WP] Get site error:', error);
    res.status(500).json({ error: 'Failed to fetch WordPress site' });
  }
});

// ===========================================
// POST /api/wordpress/sites/:siteId/test
// Test WordPress site connection
// ===========================================
router.post('/sites/:siteId/test', authenticateToken, async (req, res) => {
  try {
    const site = await db.wordpressSites.findById(req.params.siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Decrypt password and create client
    const wp_app_password = decryptPassword(site.wp_app_password_encrypted);
    const wpClient = new WordPressClient(site.site_url, site.wp_username, wp_app_password);

    // Test connection
    const verification = await wpClient.verifyConnection();

    if (!verification.success) {
      // Update site status
      await db.wordpressSites.update(site.id, {
        is_connected: false,
        connection_error: verification.error.message,
        last_verified_at: new Date(),
      });

      return res.status(400).json({
        success: false,
        error: 'Failed to connect to WordPress site',
        details: verification.error,
      });
    }

    // Update site status
    await db.wordpressSites.update(site.id, {
      is_connected: true,
      connection_error: null,
      last_verified_at: new Date(),
    });

    res.json({
      success: true,
      message: 'Connection test successful',
      site_name: verification.site_name,
      wp_version: verification.wp_version,
      user: verification.user_name,
      has_woocommerce: verification.has_woocommerce,
    });
  } catch (error) {
    console.error('[WP] Test connection error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ===========================================
// POST /api/wordpress/sites/:siteId/refresh
// Refresh pages and posts from WordPress
// ===========================================
router.post('/sites/:siteId/refresh', authenticateToken, async (req, res) => {
  try {
    const site = await db.wordpressSites.findById(req.params.siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Decrypt password and create client
    const wp_app_password = decryptPassword(site.wp_app_password_encrypted);
    const wpClient = new WordPressClient(site.site_url, site.wp_username, wp_app_password);

    // Verify connection still works
    const verification = await wpClient.verifyConnection();
    if (!verification.success) {
      console.log("[WP] Connection verification failed:", verification);
      return res.status(400).json({
        error: 'Failed to connect to WordPress site',
        details: verification.error,
      });
    }

    // Fetch pages
    const pagesResult = await wpClient.fetchPages();
    if (pagesResult.success) {
      await db.wordpressSites.updatePages(site.id, pagesResult.pages);
    }

    // Fetch posts
    const postsResult = await wpClient.fetchPosts();
    if (postsResult.success) {
      await db.wordpressSites.updatePosts(site.id, postsResult.posts);
    }

    res.json({
      success: true,
      message: 'WordPress site refreshed successfully',
      pages_count: pagesResult.success ? pagesResult.total : 0,
      posts_count: postsResult.success ? postsResult.total : 0,
      last_verified_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[WP] Refresh site error:', error);
    res.status(500).json({ error: 'Failed to refresh WordPress site' });
  }
});

// ===========================================
// DELETE /api/wordpress/sites/:siteId
// Remove WordPress site connection
// ===========================================

// ===========================================
// GET /api/wordpress/sites/:siteId/pages
// Get WordPress pages for a site  
// ===========================================
router.get("/sites/:siteId/pages", authenticateToken, async (req, res) => {
  try {
    const site = await db.wordpressSites.findById(req.params.siteId);

    if (!site) {
      return res.status(404).json({ error: "WordPress site not found" });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const pages = Array.isArray(site.available_pages) ? site.available_pages : [];

    res.json({
      pages: pages,
      total: pages.length
    });
  } catch (error) {
    console.error("[WP] Get pages error:", error);
    res.status(500).json({ error: "Failed to fetch pages" });
  }
});
router.delete('/sites/:siteId', authenticateToken, async (req, res) => {
  console.log("[WP] DELETE site request:", req.params.siteId, "by org:", req.organizationId);
  try {
    const site = await db.wordpressSites.findById(req.params.siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.wordpressSites.delete(req.params.siteId);

    res.json({
      success: true,
      message: 'WordPress site removed successfully',
    });
  } catch (error) {
    console.error('[WP] Delete site error:', error);
    res.status(500).json({ error: 'Failed to remove WordPress site' });
  }
});

// ===========================================
// POST /api/wordpress/sites/:siteId/pages/:pageId/analyze
// Analyze WordPress page and detect editable sections with AI
// ===========================================
router.post('/sites/:siteId/pages/:pageId/analyze', authenticateToken, async (req, res) => {
  try {
    const { siteId, pageId } = req.params;

    // Get WordPress site
    const site = await db.wordpressSites.findById(siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Decrypt password and create client
    const wp_app_password = decryptPassword(site.wp_app_password_encrypted);
    const wpClient = new WordPressClient(site.site_url, site.wp_username, wp_app_password);

    // Fetch page content
    console.log(`[WP] Fetching page ${pageId} for analysis...`);
    const pageResult = await wpClient.getPage(pageId);

    if (!pageResult.success) {
      console.log('[WP] Failed to fetch page:', pageResult.error);
      return res.status(400).json({
        error: 'Failed to fetch WordPress page',
        details: pageResult.error,
      });
    }

    const page = pageResult.page;
    console.log(`[WP] Page fetched: ${page.title}`);

    // Analyze page with AI section detector
    const detector = new SectionDetector();
    const analysisResult = await detector.detectSections(page.content, page.title);

    if (!analysisResult.success) {
      console.log('[WP] Section detection failed:', analysisResult.error);
      return res.status(500).json({
        error: 'Failed to analyze page sections',
        details: analysisResult.error,
      });
    }

    console.log(`[WP] Detected ${analysisResult.sections.length} sections`);

    res.json({
      success: true,
      page: {
        id: page.id,
        title: page.title,
        url: page.link,
      },
      sections: analysisResult.sections,
      metadata: {
        total_sections: analysisResult.sections.length,
        analyzed_at: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error('[WP] Analyze page error:', error);
    res.status(500).json({
      error: 'Failed to analyze WordPress page',
      details: error.message,
    });
  }
});

// ===========================================
// POST /api/wordpress/sites/:siteId/pages/:pageId/analyze-visual
// Analyze WordPress page visually with Playwright (screenshots + visual sections)
// ===========================================
router.post('/sites/:siteId/pages/:pageId/analyze-visual', authenticateToken, async (req, res) => {
  try {
    const { siteId, pageId } = req.params;

    // Get WordPress site
    const site = await db.wordpressSites.findById(siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Decrypt password and create client
    const wp_app_password = decryptPassword(site.wp_app_password_encrypted);
    const wpClient = new WordPressClient(site.site_url, site.wp_username, wp_app_password);

    // Fetch page to get URL
    console.log(`[WP] Fetching page ${pageId} for visual analysis...`);
    const pageResult = await wpClient.getPage(pageId);

    if (!pageResult.success) {
      console.log('[WP] Failed to fetch page:', pageResult.error);
      return res.status(400).json({
        error: 'Failed to fetch WordPress page',
        details: pageResult.error,
      });
    }

    const page = pageResult.page;
    console.log(`[WP] Page fetched: ${page.title}, URL: ${page.link}`);

    // Analyze page visually with Playwright
    const visualAnalyzer = new VisualAnalyzer();
    const analysisResult = await visualAnalyzer.analyzePage(page.link, pageId);
    await visualAnalyzer.close();

    if (!analysisResult.success) {
      console.log('[WP] Visual analysis failed:', analysisResult.error);
      return res.status(500).json({
        error: 'Failed to analyze page visually',
        details: analysisResult.error,
      });
    }

    console.log(`[WP] Visual analysis completed: ${analysisResult.sections.length} sections detected`);

    res.json({
      success: true,
      page: {
        id: page.id,
        title: page.title,
        url: page.link,
      },
      screenshot: analysisResult.screenshot,
      sections: analysisResult.sections,
      metadata: {
        ...analysisResult.metadata,
        total_sections: analysisResult.sections.length,
        analyzed_at: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error('[WP] Visual analyze page error:', error);
    res.status(500).json({
      error: 'Failed to analyze WordPress page visually',
      details: error.message,
    });
  }
});

// ===========================================
// WOOCOMMERCE ENDPOINTS
// ===========================================

// ===========================================
// GET /api/wordpress/sites/:siteId/products
// List WooCommerce products
// ===========================================
router.get('/sites/:siteId/products', authenticateToken, async (req, res) => {
  try {
    const site = await db.wordpressSites.findById(req.params.siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Decrypt password and create client
    const wp_app_password = decryptPassword(site.wp_app_password_encrypted);
    const wpClient = new WordPressClient(site.site_url, site.wp_username, wp_app_password);

    // Fetch products
    const productsResult = await wpClient.fetchProducts();

    if (!productsResult.success) {
      return res.status(400).json({
        success: false,
        error: productsResult.error.message,
        code: productsResult.error.code,
      });
    }

    res.json({
      success: true,
      products: productsResult.products,
      total: productsResult.total,
    });

  } catch (error) {
    console.error('[WP] Fetch products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products',
    });
  }
});

// ===========================================
// GET /api/wordpress/sites/:siteId/products/:productId
// Get single WooCommerce product
// ===========================================
router.get('/sites/:siteId/products/:productId', authenticateToken, async (req, res) => {
  try {
    const { siteId, productId } = req.params;
    const site = await db.wordpressSites.findById(siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Decrypt password and create client
    const wp_app_password = decryptPassword(site.wp_app_password_encrypted);
    const wpClient = new WordPressClient(site.site_url, site.wp_username, wp_app_password);

    // Get product
    const productResult = await wpClient.getProduct(productId);

    if (!productResult.success) {
      return res.status(400).json({
        success: false,
        error: productResult.error.message,
      });
    }

    res.json({
      success: true,
      product: productResult.product,
    });

  } catch (error) {
    console.error('[WP] Get product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product',
    });
  }
});

// ===========================================
// PUT /api/wordpress/sites/:siteId/products/:productId
// Update WooCommerce product
// ===========================================
router.put('/sites/:siteId/products/:productId', authenticateToken, async (req, res) => {
  try {
    const { siteId, productId } = req.params;
    const updateData = req.body;

    const site = await db.wordpressSites.findById(siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Decrypt password and create client
    const wp_app_password = decryptPassword(site.wp_app_password_encrypted);
    const wpClient = new WordPressClient(site.site_url, site.wp_username, wp_app_password);

    // Update product
    const updateResult = await wpClient.updateProduct(productId, updateData);

    if (!updateResult.success) {
      return res.status(400).json({
        success: false,
        error: updateResult.error.message,
      });
    }

    // Log update to database
    await db.contentUpdates.create({
      organization_id: req.organizationId,
      wordpress_site_id: siteId,
      wp_content_type: 'product',
      update_instructions: `Updated product: ${updateData.name || productId}`,
      generated_content: JSON.stringify(updateData),
    });

    res.json({
      success: true,
      product: updateResult.product,
      message: 'Product updated successfully',
    });

  } catch (error) {
    console.error('[WP] Update product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product',
    });
  }
});

// ===========================================
// MEDIA LIBRARY ENDPOINTS
// ===========================================

// ===========================================
// POST /api/wordpress/sites/:siteId/media/upload
// Upload image to WordPress media library
// ===========================================
router.post('/sites/:siteId/media/upload', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const { siteId } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided',
      });
    }

    const site = await db.wordpressSites.findById(siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Decrypt password and create client
    const wp_app_password = decryptPassword(site.wp_app_password_encrypted);
    const wpClient = new WordPressClient(site.site_url, site.wp_username, wp_app_password);

    // Upload image
    const uploadResult = await wpClient.uploadImage(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    if (!uploadResult.success) {
      return res.status(400).json({
        success: false,
        error: uploadResult.error.message,
      });
    }

    res.json({
      success: true,
      media: uploadResult.media,
      message: 'Image uploaded successfully',
    });

  } catch (error) {
    console.error('[WP] Upload image error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload image',
    });
  }
});

// ===========================================
// GET /api/wordpress/sites/:siteId/media
// Get WordPress media library items
// ===========================================
router.get('/sites/:siteId/media', authenticateToken, async (req, res) => {
  try {
    const { siteId } = req.params;
    const site = await db.wordpressSites.findById(siteId);

    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    // Verify ownership
    if (site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Decrypt password and create client
    const wp_app_password = decryptPassword(site.wp_app_password_encrypted);
    const wpClient = new WordPressClient(site.site_url, site.wp_username, wp_app_password);

    // Get media library
    const mediaResult = await wpClient.getMediaLibrary();

    if (!mediaResult.success) {
      return res.status(400).json({
        success: false,
        error: mediaResult.error.message,
      });
    }

    res.json({
      success: true,
      media: mediaResult.media,
      total: mediaResult.total,
    });

  } catch (error) {
    console.error('[WP] Get media library error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch media library',
    });
  }
});


// ===========================================
// GET /api/wordpress/page-id
// Get WordPress page ID from URL path
// ===========================================
router.get('/page-id', authenticateToken, async (req, res) => {
  try {
    const { url, site_id } = req.query;

    if (!url || !site_id) {
      return res.status(400).json({
        error: 'url and site_id are required'
      });
    }

    console.log('[WP] Looking up page ID for:', url, 'on site:', site_id);

    // Get site credentials
    const siteResult = await db.query(
      'SELECT site_url, wp_username, wp_app_password_encrypted FROM wordpress_sites WHERE id = $1 AND organization_id = $2',
      [site_id, req.organizationId]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    const site = siteResult.rows[0];
    const wpPassword = decryptPassword(site.wp_app_password_encrypted);
    const authHeader = Buffer.from(`${site.wp_username}:${wpPassword}`).toString('base64');

    // Fetch pages from WordPress
    const axios = require('axios');
    const response = await axios.get(
      `${site.site_url}/wp-json/wp/v2/pages?per_page=100`,
      {
        headers: { 'Authorization': `Basic ${authHeader}` },
        timeout: 15000
      }
    );

    console.log('[WP] Fetched', response.data.length, 'pages from WordPress');

    // Normalize the input URL (remove trailing slash, query params)
    const normalizedUrl = url.replace(/\/$/, '').split('?')[0];

    // Find page that matches the URL
    const page = response.data.find(p => {
      try {
        const pageUrl = new URL(p.link);
        const pagePath = pageUrl.pathname.replace(/\/$/, '');

        // Match by path
        return pagePath === normalizedUrl ||
               pagePath === normalizedUrl + '/' ||
               normalizedUrl === '/' && (pagePath === '' || pagePath === '/');
      } catch (e) {
        return false;
      }
    });

    if (page) {
      console.log('[WP] Found page:', page.id, page.title.rendered);
      res.json({
        pageId: page.id,
        title: page.title.rendered,
        url: page.link,
        slug: page.slug
      });
    } else {
      console.log('[WP] No page found for URL, defaulting to homepage');
      // Try to find homepage
      const homepage = response.data.find(p => p.slug === 'home' || p.slug === 'homepage');
      if (homepage) {
        res.json({
          pageId: homepage.id,
          title: homepage.title.rendered,
          url: homepage.link,
          isDefault: true
        });
      } else {
        // Fallback to first page
        res.json({
          pageId: response.data[0]?.id || 15,
          title: response.data[0]?.title.rendered || 'Home',
          url: response.data[0]?.link || site.site_url,
          isDefault: true
        });
      }
    }

  } catch (error) {
    console.error('[WP] Error getting page ID:', error.message);
    res.status(500).json({
      error: 'Failed to get page ID',
      details: error.message
    });
  }
});
module.exports = router;
