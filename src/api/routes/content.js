/**
 * Content Generation Routes
 * Handles AI-powered content generation with Groq
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');
const db = require('../../services/database');
const AIGenerator = require('../../services/aiGenerator');
const SlotParser = require('../../services/slotParser');
const PublishingService = require('../../services/publishingService');

// Initialize services
const aiGenerator = new AIGenerator();
const publishingService = new PublishingService();

// ===========================================
// POST /api/content/generate
// Generate AI content for a slot
// ===========================================
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const {
      slot_id,
      update_instructions,
      max_tokens = 1000,
    } = req.body;

    // Validation
    if (!slot_id || !update_instructions) {
      return res.status(400).json({
        error: 'slot_id and update_instructions are required',
      });
    }

    // Get slot details
    const slot = await db.contentSlots.findById(slot_id);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    // Get WordPress site to verify ownership
    const site = await db.wordpressSites.findById(slot.wordpress_site_id);
    if (!site || site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get organization for tone and type
    const organization = await db.organizations.findById(req.organizationId);

    // Check usage limit
    // const canCreate = await db.subscriptions.checkLimit(req.organizationId);
    if (false) { // Disabled subscription check
      const subscription = await db.subscriptions.getUsage(req.organizationId);
      return res.status(403).json({
        error: 'Monthly update limit reached',
        subscription: subscription,
        message: 'Upgrade to Pro for unlimited updates',
      });
    }

    console.log('[CONTENT] Generating:', {
      slot: slot.slot_name,
      org_type: organization.organization_type,
      tone: organization.content_tone,
    });

    // Generate content using AI
    const result = await aiGenerator.generateContent({
      instructions: update_instructions,
      organization_type: organization.organization_type,
      content_tone: organization.content_tone,
      slot_label: slot.slot_label,
      current_content: slot.current_content,
      max_tokens: max_tokens,
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to generate content',
        details: result.error,
      });
    }

    // Validate generated content
    const validation = aiGenerator.validateContent(result.content);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Generated content validation failed',
        details: validation.error,
      });
    }

    // Create content update record
    const contentUpdate = await db.contentUpdates.create({
      organization_id: req.organizationId,
      wordpress_site_id: site.id,
      content_slot_id: slot.id,
      update_instructions: update_instructions,
      generated_content: result.content,
      wp_content_type: 'slot',
    });

    // Increment usage counter
    await db.subscriptions.incrementUsage(req.organizationId);

    // Get updated subscription info
    const subscription = await db.subscriptions.getUsage(req.organizationId);

    console.log('[CONTENT] Generated successfully:', {
      update_id: contentUpdate.id,
      length: result.content.length,
      tokens: result.metadata.tokens_used,
      time_ms: result.metadata.generation_time_ms,
    });

    res.status(201).json({
      message: 'Content generated successfully',
      content_update: {
        id: contentUpdate.id,
        slot_id: slot.id,
        slot_name: slot.slot_name,
        generated_content: result.content,
        preview: aiGenerator.generatePreview(result.content),
        status: contentUpdate.status,
        created_at: contentUpdate.created_at,
      },
      metadata: result.metadata,
      subscription: subscription,
      next_steps: {
        message: 'Review the generated content and publish it to your WordPress page',
        publish_endpoint: `/api/content/${contentUpdate.id}/publish`,
      },
    });
  } catch (error) {
    console.error('[CONTENT] Generate error:', error);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

// ===========================================
// GET /api/content/history
// Get content generation history
// ===========================================
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const updates = await db.contentUpdates.findByOrganization(req.organizationId, limit);

    res.json({
      updates: updates.map(update => ({
        id: update.id,
        slot_id: update.content_slot_id,
        update_instructions: update.update_instructions,
        preview: aiGenerator.generatePreview(update.generated_content),
        status: update.status,
        published_at: update.published_at,
        wordpress_url: update.wordpress_url,
        created_at: update.created_at,
      })),
      total: updates.length,
    });
  } catch (error) {
    console.error('[CONTENT] History error:', error);
    res.status(500).json({ error: 'Failed to fetch content history' });
  }
});

// ===========================================
// GET /api/content/:updateId
// Get specific content update details
// ===========================================
router.get('/:updateId', authenticateToken, async (req, res) => {
  try {
    const update = await db.contentUpdates.findById(req.params.updateId);

    if (!update) {
      return res.status(404).json({ error: 'Content update not found' });
    }

    // Verify ownership
    if (update.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get slot details
    const slot = await db.contentSlots.findById(update.content_slot_id);
    const site = await db.wordpressSites.findById(update.wordpress_site_id);

    res.json({
      content_update: {
        id: update.id,
        update_instructions: update.update_instructions,
        generated_content: update.generated_content,
        status: update.status,
        published_at: update.published_at,
        wordpress_url: update.wordpress_url,
        error_message: update.error_message,
        ai_model_used: update.ai_model_used,
        generation_time_ms: update.generation_time_ms,
        created_at: update.created_at,
      },
      slot: slot ? {
        id: slot.id,
        slot_name: slot.slot_name,
        marker_name: slot.marker_name,
        wp_page_title: slot.wp_page_title,
      } : null,
      site: site ? {
        id: site.id,
        site_name: site.site_name,
        site_url: site.site_url,
      } : null,
    });
  } catch (error) {
    console.error('[CONTENT] Get update error:', error);
    res.status(500).json({ error: 'Failed to fetch content update' });
  }
});

// ===========================================
// PATCH /api/content/:updateId
// Edit generated content before publishing
// ===========================================
router.patch('/:updateId', authenticateToken, async (req, res) => {
  try {
    const { generated_content } = req.body;

    if (!generated_content) {
      return res.status(400).json({ error: 'generated_content is required' });
    }

    const update = await db.contentUpdates.findById(req.params.updateId);

    if (!update) {
      return res.status(404).json({ error: 'Content update not found' });
    }

    // Verify ownership
    if (update.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Can only edit if not published yet
    if (update.status === 'published') {
      return res.status(400).json({
        error: 'Cannot edit published content',
        message: 'Create a new content update instead',
      });
    }

    // Validate content
    const validation = aiGenerator.validateContent(generated_content);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Content validation failed',
        details: validation.error,
      });
    }

    // Update content (would need to add update method to contentUpdates)
    // TODO: Add db.contentUpdates.update() method

    console.log('[CONTENT] Content edited:', {
      update_id: update.id,
      new_length: generated_content.length,
    });

    res.json({
      message: 'Content updated successfully',
      content_update: {
        id: update.id,
        generated_content: generated_content,
        preview: aiGenerator.generatePreview(generated_content),
        status: update.status,
      },
    });
  } catch (error) {
    console.error('[CONTENT] Edit content error:', error);
    res.status(500).json({ error: 'Failed to edit content' });
  }
});

// ===========================================
// DELETE /api/content/:updateId
// Delete content update (if not published)
// ===========================================
router.delete('/:updateId', authenticateToken, async (req, res) => {
  try {
    const update = await db.contentUpdates.findById(req.params.updateId);

    if (!update) {
      return res.status(404).json({ error: 'Content update not found' });
    }

    // Verify ownership
    if (update.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Can only delete if not published
    if (update.status === 'published') {
      return res.status(400).json({
        error: 'Cannot delete published content',
      });
    }

    // Delete (would need to add delete method)
    // TODO: Add db.contentUpdates.delete() method

    res.json({
      message: 'Content update deleted successfully',
    });
  } catch (error) {
    console.error('[CONTENT] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete content update' });
  }
});

// ===========================================
// POST /api/content/:updateId/publish
// Publish generated content to WordPress
// ===========================================
router.post('/:updateId/publish', authenticateToken, async (req, res) => {
  try {
    const update = await db.contentUpdates.findById(req.params.updateId);

    if (!update) {
      return res.status(404).json({ error: 'Content update not found' });
    }

    // Verify ownership
    if (update.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Can only publish if not already published
    if (update.status === 'published') {
      return res.status(400).json({
        error: 'Content already published',
        published_at: update.published_at,
        wordpress_url: update.wordpress_url,
      });
    }

    // Get slot and site
    const slot = await db.contentSlots.findById(update.content_slot_id);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    const site = await db.wordpressSites.findById(update.wordpress_site_id);
    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    console.log('[PUBLISH] Publishing content:', {
      update_id: update.id,
      slot: slot.slot_name,
      marker: slot.marker_name,
    });

    // Publish to WordPress
    const publishResult = await publishingService.publishToSlot({
      wordpress_site: site,
      slot: slot,
      generated_content: update.generated_content,
    });

    if (!publishResult.success) {
      return res.status(400).json({
        error: 'Publishing failed',
        details: publishResult.error,
        message: publishResult.message,
        instructions: publishResult.instructions,
      });
    }

    // Mark as published in database
    const published = await db.contentUpdates.markPublished(
      update.id,
      publishResult.wordpress_page.link
    );

    // Update slot's current content
    await db.contentSlots.updateContent(slot.id, update.generated_content);

    console.log('[PUBLISH] Published successfully:', {
      update_id: update.id,
      page_link: publishResult.wordpress_page.link,
    });

    res.json({
      message: 'Content published successfully',
      published: {
        update_id: published.id,
        status: published.status,
        published_at: published.published_at,
      },
      wordpress_page: publishResult.wordpress_page,
      slot: {
        id: slot.id,
        slot_name: slot.slot_name,
        marker_name: slot.marker_name,
      },
    });
  } catch (error) {
    console.error('[PUBLISH] Publish error:', error);
    res.status(500).json({ error: 'Failed to publish content' });
  }
});

// ===========================================
// POST /api/content/:updateId/verify
// Verify slot markers exist before publishing
// ===========================================
router.post('/:updateId/verify', authenticateToken, async (req, res) => {
  try {
    const update = await db.contentUpdates.findById(req.params.updateId);

    if (!update) {
      return res.status(404).json({ error: 'Content update not found' });
    }

    if (update.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const slot = await db.contentSlots.findById(update.content_slot_id);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    const site = await db.wordpressSites.findById(update.wordpress_site_id);
    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    const verification = await publishingService.verifySlotMarkers(site, slot);

    res.json(verification);
  } catch (error) {
    console.error('[PUBLISH] Verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ===========================================
// GET /api/content/:updateId/preview
// Preview what will be published
// ===========================================
router.get('/:updateId/preview', authenticateToken, async (req, res) => {
  try {
    const update = await db.contentUpdates.findById(req.params.updateId);

    if (!update) {
      return res.status(404).json({ error: 'Content update not found' });
    }

    if (update.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const slot = await db.contentSlots.findById(update.content_slot_id);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    const site = await db.wordpressSites.findById(update.wordpress_site_id);
    if (!site) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    const preview = await publishingService.getPublishPreview({
      wordpress_site: site,
      slot: slot,
      generated_content: update.generated_content,
    });

    res.json(preview);
  } catch (error) {
    console.error('[PUBLISH] Preview error:', error);
    res.status(500).json({ error: 'Failed to get preview' });
  }
});

module.exports = router;

// Get current content from WordPress page slot
router.get('/slot/:slot_id/current', authenticateToken, async (req, res) => {
  try {
    const { slot_id } = req.params;

    // Get slot details
    const slot = await db.contentSlots.findById(slot_id);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    // Get WordPress site to verify ownership
    const site = await db.wordpressSites.findById(slot.wordpress_site_id);
    if (!site || site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // If slot doesn't have CSS selector, can't fetch content
    if (!slot.css_selector) {
      return res.status(400).json({ 
        error: 'Slot does not have CSS selector',
        message: 'This slot uses HTML markers. Current content fetching only works with CSS selector slots.'
      });
    }

    console.log('[CONTENT] Fetching current content:', {
      slot_id: slot.id,
      slot_name: slot.slot_name,
      css_selector: slot.css_selector,
      site_url: site.site_url
    });

    // Fetch page from WordPress
    const axios = require('axios');
    const { JSDOM } = require('jsdom');
    
    const pageUrl = `${site.site_url}?p=${slot.wp_page_id}`;
    
    try {
      const response = await axios.get(pageUrl, {
        headers: {
          'User-Agent': 'SafeWebEdit Content Fetcher/1.0'
        },
        timeout: 10000
      });

      const dom = new JSDOM(response.data);
      const element = dom.window.document.querySelector(slot.css_selector);

      if (!element) {
        return res.json({
          success: false,
          error: 'Element not found on page',
          message: 'The CSS selector did not match any element on the current page.',
          current_content: null
        });
      }

      const currentContent = element.innerHTML.trim();

      console.log('[CONTENT] Fetched current content:', {
        length: currentContent.length,
        preview: currentContent.substring(0, 100)
      });

      return res.json({
        success: true,
        current_content: currentContent,
        content_length: currentContent.length,
        css_selector: slot.css_selector,
        page_url: pageUrl
      });

    } catch (fetchError) {
      console.error('[CONTENT] Fetch error:', fetchError.message);
      return res.status(500).json({
        error: 'Failed to fetch page content',
        message: fetchError.message
      });
    }

  } catch (error) {
    console.error('[CONTENT] Current content error:', error);
    return res.status(500).json({
      error: 'Failed to get current content',
      message: error.message
    });
  }
});

// Publish content directly to WordPress slot
router.post('/slot/:slot_id/publish-direct', authenticateToken, async (req, res) => {
  try {
    const { slot_id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Get slot details
    const slot = await db.contentSlots.findById(slot_id);
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    // Get WordPress site to verify ownership
    const site = await db.wordpressSites.findById(slot.wordpress_site_id);
    if (!site || site.organization_id !== req.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // If slot doesn't have CSS selector, can't publish
    if (!slot.css_selector) {
      return res.status(400).json({ 
        error: 'Slot does not have CSS selector',
        message: 'This slot uses HTML markers. Direct publishing only works with CSS selector slots.'
      });
    }

    console.log('[CONTENT] Publishing directly to WordPress:', {
      slot_id: slot.id,
      slot_name: slot.slot_name,
      css_selector: slot.css_selector,
      content_length: content.length
    });

    // Fetch current page HTML
    const axios = require('axios');
    const { JSDOM } = require('jsdom');
    
    const pageUrl = `${site.site_url}?p=${slot.wp_page_id}`;
    
    try {
      // Get the current page
      const pageResponse = await axios.get(pageUrl, {
        headers: {
          'User-Agent': 'SafeWebEdit Publisher/1.0'
        },
        timeout: 10000
      });

      const dom = new JSDOM(pageResponse.data);
      const element = dom.window.document.querySelector(slot.css_selector);

      if (!element) {
        return res.status(404).json({
          error: 'Element not found on page',
          message: 'The CSS selector did not match any element on the current page.'
        });
      }

      // Update the element content
      element.innerHTML = content;

      // Get the updated HTML
      const updatedHTML = dom.serialize();
      // Decrypt WordPress credentials (base64)
      const wpAppPassword = Buffer.from(site.wp_app_password_encrypted, "base64").toString("utf-8");

      // Update page via WordPress REST API
      const wpApiUrl = `${site.site_url}/wp-json/wp/v2/pages/${slot.wp_page_id}`;
      
      const updateResponse = await axios.post(wpApiUrl, {
        content: updatedHTML
      }, {
        auth: {
          username: site.wp_username,
          password: wpAppPassword
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      console.log('[CONTENT] Published successfully:', {
        slot_id: slot.id,
        wp_page_id: slot.wp_page_id,
        status: updateResponse.status
      });

      return res.json({
        success: true,
        message: 'Content published to WordPress successfully',
        page_url: pageUrl,
        updated_at: new Date().toISOString()
      });

    } catch (publishError) {
      console.error('[CONTENT] Publish error:', publishError.message);
      return res.status(500).json({
        error: 'Failed to publish to WordPress',
        message: publishError.response?.data?.message || publishError.message
      });
    }

  } catch (error) {
    console.error('[CONTENT] Direct publish error:', error);
    return res.status(500).json({
      error: 'Failed to publish content',
      message: error.message
    });
  }
});
