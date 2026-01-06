const express = require('express');
const router = express.Router();
const axios = require('axios');
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ===========================================
// POST /api/auto-discovery/scan
// Auto-discover editable content from WordPress site
// ===========================================
router.post('/scan', async (req, res) => {
  const { organizationId } = req;
  const { siteId } = req.body;

  if (!siteId) {
    return res.status(400).json({ error: 'Site ID required' });
  }

  try {
    console.log('[AUTO-DISCOVERY] Starting scan for site:', siteId);

    // Get WordPress site details
    const siteResult = await pool.query(
      `SELECT id, site_url, wp_username, wp_app_password
       FROM wordpress_sites
       WHERE id = $1 AND organization_id = $2`,
      [siteId, organizationId]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    const site = siteResult.rows[0];
    const { site_url, wp_username, wp_app_password } = site;

    // Decrypt password
    const decodedPassword = Buffer.from(wp_app_password, 'base64').toString('utf-8');
    const authHeader = Buffer.from(`${wp_username}:${decodedPassword}`).toString('base64');

    // Fetch all pages from WordPress
    const pagesResponse = await axios.get(`${site_url}/wp-json/wp/v2/pages`, {
      headers: {
        'Authorization': `Basic ${authHeader}`
      },
      params: {
        per_page: 100,
        _fields: 'id,title,content,link'
      },
      timeout: 15000
    });

    const pages = pagesResponse.data;
    console.log('[AUTO-DISCOVERY] Found', pages.length, 'pages');

    // Fetch all posts
    const postsResponse = await axios.get(`${site_url}/wp-json/wp/v2/posts`, {
      headers: {
        'Authorization': `Basic ${authHeader}`
      },
      params: {
        per_page: 100,
        _fields: 'id,title,content,link'
      },
      timeout: 15000
    });

    const posts = postsResponse.data;
    console.log('[AUTO-DISCOVERY] Found', posts.length, 'posts');

    const allContent = [...pages, ...posts];
    let slotsCreated = 0;
    let slotsUpdated = 0;

    // Process each page/post and extract editable elements
    for (const item of allContent) {
      const contentType = pages.includes(item) ? 'page' : 'post';

      // Extract text from HTML content
      const textContent = item.content.rendered || '';

      // Create a slot for the main content
      const markerName = `${contentType.toUpperCase()}_${item.id}_CONTENT`;
      const slotName = `${contentType}_${item.id}_content`;

      try {
        // Check if slot already exists
        const existingSlot = await pool.query(
          `SELECT id FROM content_slots
           WHERE wordpress_site_id = $1 AND marker_name = $2`,
          [siteId, markerName]
        );

        if (existingSlot.rows.length > 0) {
          // Update existing slot
          await pool.query(
            `UPDATE content_slots
             SET current_content = $1,
                 wp_page_title = $2,
                 last_updated_at = NOW(),
                 updated_at = NOW()
             WHERE id = $3`,
            [textContent, item.title.rendered, existingSlot.rows[0].id]
          );
          slotsUpdated++;
        } else {
          // Create new slot
          await pool.query(
            `INSERT INTO content_slots (
              wordpress_site_id,
              slot_name,
              slot_label,
              description,
              wp_page_id,
              wp_page_title,
              marker_name,
              current_content,
              slot_type,
              css_selector,
              section_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              siteId,
              slotName,
              `${item.title.rendered} - Main Content`,
              `Editable content for ${contentType}: ${item.title.rendered}`,
              item.id,
              item.title.rendered,
              markerName,
              textContent,
              'auto_discovered',
              `.entry-content, .post-content, article .content`,
              contentType
            ]
          );
          slotsCreated++;
        }
      } catch (slotError) {
        console.error('[AUTO-DISCOVERY] Error processing slot:', slotError.message);
      }
    }

    console.log('[AUTO-DISCOVERY] Scan complete:', {
      slotsCreated,
      slotsUpdated,
      totalPages: pages.length,
      totalPosts: posts.length
    });

    res.json({
      success: true,
      message: 'Auto-discovery scan completed',
      stats: {
        pagesFound: pages.length,
        postsFound: posts.length,
        slotsCreated,
        slotsUpdated,
        totalSlots: slotsCreated + slotsUpdated
      }
    });

  } catch (error) {
    console.error('[AUTO-DISCOVERY] Error:', error.message);
    res.status(500).json({
      error: 'Auto-discovery failed',
      details: error.message
    });
  }
});

// ===========================================
// POST /api/auto-discovery/create-slot
// Create or retrieve slot based on CSS selector (on-the-fly)
// ===========================================
router.post('/create-slot', async (req, res) => {
  const { organizationId } = req;
  const { siteId, cssSelector, content, pageId, pageTitle, elementText } = req.body;

  if (!siteId || !cssSelector) {
    return res.status(400).json({ error: 'Site ID and CSS selector required' });
  }

  try {
    console.log('[AUTO-DISCOVERY] Creating slot for:', { siteId, cssSelector });

    // Generate unique marker name from CSS selector
    const markerName = `AUTO_${crypto.createHash('md5').update(cssSelector).digest('hex').substring(0, 12).toUpperCase()}`;
    const slotName = `auto_${crypto.createHash('md5').update(cssSelector).digest('hex').substring(0, 12)}`;

    // Check if slot already exists
    const existingSlot = await pool.query(
      `SELECT * FROM content_slots
       WHERE wordpress_site_id = $1 AND css_selector = $2`,
      [siteId, cssSelector]
    );

    if (existingSlot.rows.length > 0) {
      console.log('[AUTO-DISCOVERY] Slot already exists:', existingSlot.rows[0].id);
      return res.json({
        success: true,
        slot: existingSlot.rows[0],
        created: false
      });
    }

    // Create new slot
    const newSlot = await pool.query(
      `INSERT INTO content_slots (
        wordpress_site_id,
        slot_name,
        slot_label,
        description,
        wp_page_id,
        wp_page_title,
        marker_name,
        current_content,
        slot_type,
        css_selector,
        section_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        siteId,
        slotName,
        elementText ? `${elementText.substring(0, 50)}...` : 'Auto-discovered Content',
        `Auto-discovered content with selector: ${cssSelector}`,
        pageId || 0,
        pageTitle || 'Unknown Page',
        markerName,
        content || elementText || '',
        'auto_discovered',
        cssSelector,
        'auto'
      ]
    );

    console.log('[AUTO-DISCOVERY] Created new slot:', newSlot.rows[0].id);

    res.json({
      success: true,
      slot: newSlot.rows[0],
      created: true
    });

  } catch (error) {
    console.error('[AUTO-DISCOVERY] Error creating slot:', error.message);
    res.status(500).json({
      error: 'Failed to create slot',
      details: error.message
    });
  }
});

// ===========================================
// PUT /api/auto-discovery/update-content
// Update WordPress content via REST API
// ===========================================
router.put('/update-content', async (req, res) => {
  const { organizationId } = req;
  const { slotId, content } = req.body;

  if (!slotId || !content) {
    return res.status(400).json({ error: 'Slot ID and content required' });
  }

  try {
    console.log('[AUTO-DISCOVERY] Updating content for slot:', slotId);

    // Get slot and site details
    const slotResult = await pool.query(
      `SELECT cs.*, ws.site_url, ws.wp_username, ws.wp_app_password
       FROM content_slots cs
       JOIN wordpress_sites ws ON cs.wordpress_site_id = ws.id
       WHERE cs.id = $1`,
      [slotId]
    );

    if (slotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    const slot = slotResult.rows[0];
    const { site_url, wp_username, wp_app_password, wp_page_id, section_type } = slot;

    // Decrypt password
    const decodedPassword = Buffer.from(wp_app_password, 'base64').toString('utf-8');
    const authHeader = Buffer.from(`${wp_username}:${decodedPassword}`).toString('base64');

    // Determine WordPress endpoint (page or post)
    const endpoint = section_type === 'page' ? 'pages' : 'posts';
    const wpUrl = `${site_url}/wp-json/wp/v2/${endpoint}/${wp_page_id}`;

    // Update WordPress content
    const updateResponse = await axios.post(
      wpUrl,
      { content: content },
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('[AUTO-DISCOVERY] WordPress updated successfully');

    // Update slot in database
    await pool.query(
      `UPDATE content_slots
       SET current_content = $1,
           last_updated_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [content, slotId]
    );

    res.json({
      success: true,
      message: 'Content updated successfully',
      wpResponse: updateResponse.data
    });

  } catch (error) {
    console.error('[AUTO-DISCOVERY] Error updating content:', error.message);
    res.status(500).json({
      error: 'Failed to update content',
      details: error.message
    });
  }
});

module.exports = router;
