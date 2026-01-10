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
      `SELECT id, site_url, wp_username, wp_app_password_encrypted
       FROM wordpress_sites
       WHERE id = $1 AND organization_id = $2`,
      [siteId, organizationId]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'WordPress site not found' });
    }

    const site = siteResult.rows[0];
    const { site_url, wp_username, wp_app_password_encrypted } = site;

    // Decrypt password
    const decodedPassword = Buffer.from(wp_app_password_encrypted, 'base64').toString('utf-8');
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
  const { siteId: siteIdCamel, site_id, cssSelector, content, pageId, pageTitle, elementText, pageUrl } = req.body;
  const siteId = siteIdCamel || site_id; // Accept both formats

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
      const slot = existingSlot.rows[0];
      console.log('[AUTO-DISCOVERY] Slot already exists:', slot.id, '- Page ID:', slot.wp_page_id);
      
      // If existing slot has no page ID, try to detect and update it
      if ((!slot.wp_page_id || slot.wp_page_id === 0) && pageUrl) {
        console.log('[AUTO-DISCOVERY] Updating existing slot with page detection...');
        try {
          const siteResult = await pool.query(
            `SELECT site_url, wp_username, wp_app_password_encrypted
             FROM wordpress_sites WHERE id = $1 AND organization_id = $2`,
            [siteId, organizationId]
          );

          if (siteResult.rows.length > 0) {
            const site = siteResult.rows[0];
            const decodedPassword = Buffer.from(site.wp_app_password_encrypted, 'base64').toString('utf-8');
            const authHeader = Buffer.from(`${site.wp_username}:${decodedPassword}`).toString('base64');

            const normalizeUrl = (url) => url.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/+$/,'').toLowerCase();
            const normalizedPageUrl = normalizeUrl(pageUrl);

            const pagesResponse = await axios.get(`${site.site_url}/wp-json/wp/v2/pages`, {
              headers: { 'Authorization': `Basic ${authHeader}` },
              params: { per_page: 100, _fields: 'id,title,link' },
              timeout: 10000
            });

            const matchingPage = pagesResponse.data.find(p => normalizeUrl(p.link) === normalizedPageUrl);
            if (matchingPage) {
              await pool.query(
                `UPDATE content_slots
                 SET wp_page_id = $1, wp_page_title = $2, section_type = $3, updated_at = NOW()
                 WHERE id = $4`,
                [matchingPage.id, matchingPage.title.rendered || matchingPage.title, 'page', slot.id]
              );
              
              slot.wp_page_id = matchingPage.id;
              slot.wp_page_title = matchingPage.title.rendered || matchingPage.title;
              console.log('[AUTO-DISCOVERY] Updated existing slot with page ID:', matchingPage.id);
            }
          }
        } catch (err) {
          console.error('[AUTO-DISCOVERY] Error updating existing slot:', err.message);
        }
      }
      
      return res.json({
        success: true,
        slot: slot,
        created: false,
        updated: slot.wp_page_id > 0
      });
    }

    // Detect page ID from URL if not provided
    let detectedPageId = pageId || 0;
    let detectedPageTitle = pageTitle || 'Auto-discovered';
    let detectedSectionType = 'auto';

    if (!pageId && pageUrl) {
      console.log('[AUTO-DISCOVERY] Looking up page ID for URL:', pageUrl);
      try {
        const siteResult = await pool.query(
          `SELECT site_url, wp_username, wp_app_password_encrypted
           FROM wordpress_sites WHERE id = $1 AND organization_id = $2`,
          [siteId, organizationId]
        );

        if (siteResult.rows.length > 0) {
          const site = siteResult.rows[0];
          const decodedPassword = Buffer.from(site.wp_app_password_encrypted, 'base64').toString('utf-8');
          const authHeader = Buffer.from(`${site.wp_username}:${decodedPassword}`).toString('base64');

          const normalizeUrl = (url) => url.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/+$/,'').toLowerCase();
          const normalizedPageUrl = normalizeUrl(pageUrl);

          const pagesResponse = await axios.get(`${site.site_url}/wp-json/wp/v2/pages`, {
            headers: { 'Authorization': `Basic ${authHeader}` },
            params: { per_page: 100, _fields: 'id,title,link' },
            timeout: 10000
          });

          const matchingPage = pagesResponse.data.find(p => normalizeUrl(p.link) === normalizedPageUrl);
          if (matchingPage) {
            detectedPageId = matchingPage.id;
            detectedPageTitle = matchingPage.title.rendered || matchingPage.title;
            console.log('[AUTO-DISCOVERY] Found matching page:', detectedPageId, detectedPageTitle);
          }
            detectedSectionType = 'page';
        }
      } catch (err) {
        console.error('[AUTO-DISCOVERY] Page detection error:', err.message);
      }
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
        detectedPageId,
        detectedPageTitle,
        markerName,
        content || elementText || '',
        'auto_discovered',
        cssSelector,
        detectedSectionType
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
  const { slotId, content, pageId } = req.body;

  if (!slotId || !content) {
    return res.status(400).json({ error: 'Slot ID and content required' });
  }

  try {
    console.log('[AUTO-DISCOVERY] Updating content for slot:', slotId);

    // Get slot and site details
    const slotResult = await pool.query(
      `SELECT cs.*, ws.site_url, ws.wp_username, ws.wp_app_password_encrypted
       FROM content_slots cs
       JOIN wordpress_sites ws ON cs.wordpress_site_id = ws.id
       WHERE cs.id = $1`,
      [slotId]
    );

    if (slotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    const slot = slotResult.rows[0];
    console.log('[AUTO-DISCOVERY] Slot found - wp_page_id:', slot.wp_page_id, 'section_type:', slot.section_type);
    // Check if this is an auto-discovered slot without page ID
    const { wp_page_id } = slot;

    // Use provided pageId if available, otherwise use slot's wp_page_id, otherwise default to 15
    const targetPageId = pageId || wp_page_id || 15;
    
    // If this zone doesn't have a page ID assigned and one was provided, update it in DB
    if ((!wp_page_id || wp_page_id === 0) && pageId) {
      console.log('[AUTO-DISCOVERY] Assigning zone to page:', pageId);
      await pool.query(
        'UPDATE content_slots SET wp_page_id = $1 WHERE id = $2',
        [pageId, slotId]
      );
    }

    const { site_url, wp_username, wp_app_password_encrypted, section_type } = slot;

    // Decrypt password
    const decodedPassword = Buffer.from(wp_app_password_encrypted, 'base64').toString('utf-8');
    const authHeader = Buffer.from(`${wp_username}:${decodedPassword}`).toString('base64');

    // Determine WordPress endpoint (page or post)
    const endpoint = (section_type === "page" || (section_type === "auto" && targetPageId > 0)) ? 'pages' : 'posts';
    const wpUrl = `${site_url}/wp-json/wp/v2/${endpoint}/${pageId}`;
    console.log('[AUTO-DISCOVERY] Updating WordPress - section_type:', section_type, 'endpoint:', endpoint, 'URL:', wpUrl);

    // CRITICAL FIX: First, fetch the current page content
    const fetchResponse = await axios.get(wpUrl, {
      headers: {
        'Authorization': `Basic ${authHeader}`
      },
      timeout: 15000
    });

    const currentContent = fetchResponse.data.content.rendered || fetchResponse.data.content;
    console.log('[AUTO-DISCOVERY] Current content length:', currentContent.length);

    // Find and replace the specific zone content
    const originalContent = slot.current_content || slot.original_content;
    let updatedContent = currentContent;

    if (originalContent) {
      // Try multiple replacement strategies
      let replaced = false;

      // Strategy 1: Direct text match
      if (currentContent.includes(originalContent)) {
        updatedContent = currentContent.replace(originalContent, content);
        console.log('[AUTO-DISCOVERY] Replaced zone content (exact match)');
        replaced = true;
      }

      // Strategy 2: Match within HTML tags (e.g., <h2>text</h2>)
      if (!replaced) {
        const escapedOriginal = originalContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const htmlPattern = new RegExp(`(<[^>]+>)\\s*${escapedOriginal}\\s*(</[^>]+>)`, 'gi');
        if (htmlPattern.test(currentContent)) {
          updatedContent = currentContent.replace(htmlPattern, `$1${content}$2`);
          console.log('[AUTO-DISCOVERY] Replaced zone content (HTML tag match)');
          replaced = true;
        }
      }

      // Strategy 3: More flexible text search (strip extra whitespace)
      if (!replaced) {
        const normalizedOriginal = originalContent.trim().replace(/\s+/g, ' ');
        const normalizedCurrent = currentContent.replace(/\s+/g, ' ');
        if (normalizedCurrent.includes(normalizedOriginal)) {
          updatedContent = currentContent.replace(originalContent.trim(), content);
          console.log('[AUTO-DISCOVERY] Replaced zone content (normalized match)');
          replaced = true;
        }
      }

      if (!replaced) {
        console.log('[AUTO-DISCOVERY] WARNING: Could not find exact match for replacement');
        console.log('[AUTO-DISCOVERY] Original content:', originalContent.substring(0, 100));
        // Don't append - just return error instead
        return res.status(400).json({
          success: false,
          error: 'Cannot locate content to replace',
          message: 'The original content could not be found on the page. Please refresh and try again.'
        });
      }
    } else {
      console.log('[AUTO-DISCOVERY] ERROR: No original content stored');
      return res.status(400).json({
        success: false,
        error: 'Missing original content',
        message: 'This zone does not have original content stored. Please re-scan the page.'
      });
    }

    // Update WordPress with complete content
    const updateResponse = await axios.post(
      wpUrl,
      { content: updatedContent },
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
    if (error.response) console.error('[AUTO-DISCOVERY] WordPress response:', error.response.status, error.response.data);
    res.status(500).json({
      error: 'Failed to update content',
      details: error.message
    });
  }
});

module.exports = router;
