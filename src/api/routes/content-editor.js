const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');
const db = require('../../services/database');
const axios = require('axios');

// Helper to decrypt WordPress password
function decryptPassword(encrypted) {
  return Buffer.from(encrypted, 'base64').toString('utf-8');
}

// ===========================================
// GET /api/content-editor/slots
// Get all slots with their current content
// ===========================================
router.get('/slots', authenticateToken, async (req, res) => {
  try {
    // Get all slots for this organization
    const slotsResult = await db.query(
      `SELECT cs.*, ws.site_url as wp_url, ws.wp_username as wp_user, ws.wp_app_password_encrypted as wp_pass_encrypted, ws.site_name
       FROM content_slots cs
       JOIN wordpress_sites ws ON cs.wordpress_site_id = ws.id
       WHERE ws.organization_id = $1 AND cs.is_active = true
       ORDER BY cs.created_at DESC`,
      [req.organizationId]
    );

    if (slotsResult.rows.length === 0) {
      return res.json({ slots: [] });
    }

    const slotsWithContent = [];

    // Fetch current content from WordPress for each slot
    for (const slot of slotsResult.rows) {
      try {
        const wp_password = decryptPassword(slot.wp_pass_encrypted);
        const wpAuth = { username: slot.wp_user, password: wp_password };
        
        const pageResponse = await axios.get(
          `${slot.wp_url}/wp-json/wp/v2/pages/${slot.wp_page_id}`,
          { auth: wpAuth, timeout: 5000 }
        );

        let content = pageResponse.data.content.rendered;
        
        // Extract content between markers
        const startMarker = `<!-- SLOT_START:${slot.marker_name} -->`;
        const endMarker = `<!-- SLOT_END:${slot.marker_name} -->`;
        
        let slotContent = '';
        if (content.includes(startMarker)) {
          const startIndex = content.indexOf(startMarker) + startMarker.length;
          const endIndex = content.indexOf(endMarker);
          if (endIndex > startIndex) {
            slotContent = content.substring(startIndex, endIndex).trim();
          }
        }

        slotsWithContent.push({
          id: slot.id,
          slot_label: slot.slot_label,
          slot_name: slot.slot_name,
          marker_name: slot.marker_name,
          wp_page_title: slot.wp_page_title,
          site_name: slot.site_name,
          content: slotContent,
          wp_page_id: slot.wp_page_id,
          wordpress_site_id: slot.wordpress_site_id
        });
      } catch (err) {
        console.error(`[CONTENT-EDITOR] Error fetching content for slot ${slot.id}:`, err.message);
        slotsWithContent.push({
          id: slot.id,
          slot_label: slot.slot_label,
          slot_name: slot.slot_name,
          marker_name: slot.marker_name,
          wp_page_title: slot.wp_page_title,
          site_name: slot.site_name,
          content: '',
          error: 'Failed to load content',
          wp_page_id: slot.wp_page_id,
          wordpress_site_id: slot.wordpress_site_id
        });
      }
    }

    res.json({ slots: slotsWithContent });
  } catch (error) {
    console.error('[CONTENT-EDITOR] Get slots error:', error);
    res.status(500).json({ error: 'Failed to get slots' });
  }
});

// ===========================================
// PUT /api/content-editor/slots/:slotId
// Update slot content in WordPress
// ===========================================
router.put('/slots/:slotId', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;

    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Get slot details
    const slotResult = await db.query(
      `SELECT cs.*, ws.site_url as wp_url, ws.wp_username as wp_user, ws.wp_app_password_encrypted as wp_pass_encrypted
       FROM content_slots cs
       JOIN wordpress_sites ws ON cs.wordpress_site_id = ws.id
       WHERE cs.id = $1 AND ws.organization_id = $2`,
      [req.params.slotId, req.organizationId]
    );

    if (slotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    const slot = slotResult.rows[0];
    const wp_password = decryptPassword(slot.wp_pass_encrypted);
    const wpAuth = { username: slot.wp_user, password: wp_password };

    // Get current WordPress page content
    const pageResponse = await axios.get(
      `${slot.wp_url}/wp-json/wp/v2/pages/${slot.wp_page_id}`,
      { auth: wpAuth }
    );

    let pageContent = pageResponse.data.content.rendered;

    // Replace content between markers
    const startMarker = `<!-- SLOT_START:${slot.marker_name} -->`;
    const endMarker = `<!-- SLOT_END:${slot.marker_name} -->`;

    if (!pageContent.includes(startMarker)) {
      return res.status(400).json({ 
        error: 'Slot marker not found in WordPress page. Please create the slot first.' 
      });
    }

    const regex = new RegExp(`${startMarker}[\s\S]*?${endMarker}`, 'g');
    const newPageContent = pageContent.replace(
      regex, 
      `${startMarker}${content}${endMarker}`
    );

    // Update WordPress page
    await axios.post(
      `${slot.wp_url}/wp-json/wp/v2/pages/${slot.wp_page_id}`,
      { content: newPageContent },
      { auth: wpAuth }
    );

    console.log(`[CONTENT-EDITOR] Updated slot ${slot.slot_label}`);

    res.json({
      success: true,
      message: 'Content updated successfully',
      slot: {
        id: slot.id,
        slot_label: slot.slot_label,
        content: content
      }
    });
  } catch (error) {
    console.error('[CONTENT-EDITOR] Update error:', error);
    res.status(500).json({ 
      error: 'Failed to update content',
      details: error.message 
    });
  }
});

module.exports = router;
