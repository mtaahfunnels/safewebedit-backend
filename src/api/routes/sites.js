/**
 * Unified Sites API Routes
 * Platform-agnostic endpoints for managing WordPress and Universal websites
 */

const express = require('express');
const router = express.Router();
const SiteManager = require('../../services/siteManager');
const db = require('../../services/database');

// Middleware (assuming authenticateToken is available)
// const authenticateToken = require('../../middleware/authenticateToken');

// Create single instance of SiteManager
const siteManager = new SiteManager();

/**
 * GET /api/sites - List all sites (WordPress + Universal)
 */
router.get('/', async (req, res) => {
  try {
    const organizationId = req.organizationId;

    if (!organizationId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const sites = await siteManager.getAllSites(organizationId);

    res.json({
      success: true,
      sites,
      count: sites.length
    });

  } catch (error) {
    console.error('[API /sites] Error listing sites:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/sites/connect - Connect new site (auto-detects platform)
 */
router.post('/connect', async (req, res) => {
  try {
    const organizationId = req.organizationId;

    if (!organizationId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { platform_type, ...connectionData } = req.body;

    // Validate required fields
    if (!platform_type || !connectionData.site_url) {
      return res.status(400).json({
        success: false,
        error: 'platform_type and site_url are required'
      });
    }

    // Validate platform-specific fields
    if (platform_type === 'wordpress') {
      if (!connectionData.wp_username || !connectionData.wp_app_password) {
        return res.status(400).json({
          success: false,
          error: 'wp_username and wp_app_password are required for WordPress sites'
        });
      }
    }

    const result = await siteManager.connectSite(
      organizationId,
      { platform_type, ...connectionData }
    );

    res.status(201).json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('[API /sites/connect] Error connecting site:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/sites/:siteId - Get site details (platform-agnostic)
 */
router.get('/:siteId', async (req, res) => {
  try {
    const result = await siteManager.getSite(req.params.siteId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Site not found'
      });
    }

    // Verify site belongs to organization
    const organizationId = req.organizationId;
    if (result.site.organization_id !== organizationId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('[API /sites/:siteId] Error getting site:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/sites/:siteId/detect-sections - AI-powered section detection
 */
router.post('/:siteId/detect-sections', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { pageUrl } = req.body;

    const result = await siteManager.getSite(siteId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Site not found'
      });
    }

    // Verify site belongs to organization
    const organizationId = req.organizationId;
    if (result.site.organization_id !== organizationId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const { platform } = result;

    if (platform === 'universal') {
      // Use Playwright for live detection
      const sections = await siteManager.detectSections(siteId, pageUrl);

      res.json({
        success: true,
        platform: 'universal',
        sections,
        count: sections.length
      });

    } else {
      // WordPress uses existing REST API method
      const sections = await siteManager.detectSections(siteId);

      res.json({
        success: true,
        platform: 'wordpress',
        pages: sections.pages,
        posts: sections.posts
      });
    }

  } catch (error) {
    console.error('[API /sites/:siteId/detect-sections] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/sites/:siteId/update-content - Update content (platform-agnostic)
 */
router.post('/:siteId/update-content', async (req, res) => {
  try {
    const { siteId } = req.params;
    const updateData = req.body;

    const result = await siteManager.getSite(siteId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Site not found'
      });
    }

    // Verify site belongs to organization
    const organizationId = req.organizationId;
    if (result.site.organization_id !== organizationId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const updateResult = await siteManager.updateContent(siteId, updateData);

    // Log update to database
    await db.contentUpdates.create({
      organization_id: organizationId,
      wordpress_site_id: result.platform === 'wordpress' ? siteId : null,
      universal_site_id: result.platform === 'universal' ? siteId : null,
      content_slot_id: updateData.slotId || null,
      update_instructions: updateData.instructions || 'Manual update',
      generated_content: updateData.content,
      wp_content_type: updateData.contentType || null
    });

    res.json({
      success: true,
      platform: result.platform,
      result: updateResult
    });

  } catch (error) {
    console.error('[API /sites/:siteId/update-content] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/sites/:siteId - Disconnect site
 */
router.delete('/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;

    const result = await siteManager.getSite(siteId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Site not found'
      });
    }

    // Verify site belongs to organization
    const organizationId = req.organizationId;
    if (result.site.organization_id !== organizationId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    await siteManager.disconnectSite(siteId);

    res.json({
      success: true,
      message: 'Site disconnected successfully'
    });

  } catch (error) {
    console.error('[API /sites/:siteId] Error deleting site:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/sites/stats - Get site statistics for organization
 */
router.get('/stats/overview', async (req, res) => {
  try {
    const organizationId = req.organizationId;

    if (!organizationId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const stats = await siteManager.getSiteStats(organizationId);

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('[API /sites/stats] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
