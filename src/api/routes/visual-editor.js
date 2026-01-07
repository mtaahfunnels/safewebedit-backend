const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');
const db = require('../../services/database');
const axios = require('axios');

function decryptPassword(encrypted) {
  return Buffer.from(encrypted, 'base64').toString('utf-8');
}

router.get('/preview/:siteId/:pageId', authenticateToken, async (req, res) => {
  try {
    const { siteId, pageId } = req.params;

    const siteResult = await db.query(
      `SELECT * FROM wordpress_sites WHERE id = $1 AND organization_id = $2`,
      [siteId, req.organizationId]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const site = siteResult.rows[0];
    const wp_password = decryptPassword(site.wp_app_password_encrypted);
    const wpAuth = { username: site.wp_username, password: wp_password };

    const pageResponse = await axios.get(
      `${site.site_url}/wp-json/wp/v2/pages/${pageId}`,
      { auth: wpAuth, timeout: 10000 }
    );

    const pageContent = pageResponse.data.content.rendered;
    const pageTitle = pageResponse.data.title.rendered;

    const slotsResult = await db.query(
      `SELECT * FROM content_slots 
       WHERE wordpress_site_id = $1 AND wp_page_id = $2 AND is_active = true`,
      [siteId, parseInt(pageId)]
    );

    let enhancedHTML = pageContent;
    const slots = [];

    for (const slot of slotsResult.rows) {
      const startMarker = `<!-- SLOT_START:${slot.marker_name} -->`;
      const endMarker = `<!-- SLOT_END:${slot.marker_name} -->`;

      if (enhancedHTML.includes(startMarker)) {
        const startIndex = enhancedHTML.indexOf(startMarker) + startMarker.length;
        const endIndex = enhancedHTML.indexOf(endMarker);
        const slotContent = enhancedHTML.substring(startIndex, endIndex).trim();

        slots.push({
          id: slot.id,
          marker_name: slot.marker_name,
          slot_label: slot.slot_label,
          content: slotContent
        });

        const wrappedSlot = `
          ${startMarker}
          <div class="editable-slot" 
               data-slot-id="${slot.id}" 
               data-slot-label="${slot.slot_label}"
               data-marker="${slot.marker_name}"
               style="position: relative; border: 2px dashed #007bff; padding: 10px; margin: 10px 0; cursor: pointer;">
            <div class="slot-badge" style="position: absolute; top: -12px; left: 10px; background: #007bff; color: white; padding: 2px 8px; font-size: 11px; border-radius: 3px; font-weight: bold; z-index: 10;">
              ${slot.slot_label}
            </div>
            ${slotContent}
          </div>
          ${endMarker}
        `;

        const regex = new RegExp(`${startMarker}[\s\S]*?${endMarker}`, 'g');
        enhancedHTML = enhancedHTML.replace(regex, wrappedSlot);
      }
    }

    const fullHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <base href="${site.site_url}/" target="_parent">
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${pageTitle}</title>
        <style>
          .editable-slot { 
            transition: all 0.2s; 
          }
          .editable-slot:hover { 
            background-color: rgba(0,123,255,0.1) !important; 
            border-color: #0056b3 !important;
            box-shadow: 0 4px 12px rgba(0,123,255,0.3) !important;
          }
        </style>
        <script>
          document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('.editable-slot').forEach(function(slot) {
              slot.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                window.parent.postMessage({
                  type: 'EDIT_SLOT',
                  slotId: this.getAttribute('data-slot-id'),
                  slotLabel: this.getAttribute('data-slot-label'),
                  markerName: this.getAttribute('data-marker')
                }, '*');
              });
            });
          });
        </script>
      </head>
      <body>
        ${enhancedHTML}
      </body>
      </html>
    `;

    res.json({
      success: true,
      html: fullHTML,
      slots: slots,
      pageTitle: pageTitle,
      siteUrl: site.site_url
    });

  } catch (error) {
    console.error('[VISUAL-EDITOR] Preview error:', error);
    res.status(500).json({ 
      error: 'Failed to load page preview',
      details: error.message 
    });
  }
});

router.get('/sites', authenticateToken, async (req, res) => {
  try {
    const sitesResult = await db.query(
      `SELECT id, site_name, site_url, available_pages, is_connected
       FROM wordpress_sites
       WHERE organization_id = $1 AND is_connected = true
       ORDER BY created_at DESC`,
      [req.organizationId]
    );

    const sites = sitesResult.rows.map(site => ({
      id: site.id,
      name: site.site_name || site.site_url,
      url: site.site_url,
      pages: site.available_pages || []
    }));

    res.json({ sites });
  } catch (error) {
    console.error('[VISUAL-EDITOR] Sites error:', error);
    res.status(500).json({ error: 'Failed to get sites' });
  }
});

module.exports = router;

// ===========================================
// GET /api/visual-editor/proxy
// Proxy WordPress content to bypass iframe restrictions
// ===========================================
router.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }

    // Fetch the WordPress page
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'SafeWebEdit/1.0'
      },
      timeout: 10000,
      maxRedirects: 5
    });

    let html = response.data;

    // Inject script to highlight editable slots
    const scriptInjection = `
      <script>
        window.addEventListener('DOMContentLoaded', function() {
          // Get all slot markers
          const slotElements = document.querySelectorAll('[data-slot-id]');
          
          slotElements.forEach(function(element) {
            element.style.border = '2px dashed #007bff';
            element.style.position = 'relative';
            element.style.cursor = 'pointer';
            
            // Add label badge
            const badge = document.createElement('div');
            badge.textContent = element.getAttribute('data-slot-label');
            badge.style.position = 'absolute';
            badge.style.top = '-12px';
            badge.style.left = '10px';
            badge.style.background = '#007bff';
            badge.style.color = 'white';
            badge.style.padding = '2px 8px';
            badge.style.fontSize = '11px';
            badge.style.borderRadius = '3px';
            badge.style.fontWeight = 'bold';
            badge.style.zIndex = '1000';
            element.appendChild(badge);
            
            // Add click handler
            element.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              window.parent.postMessage({
                type: 'EDIT_SLOT',
                slotId: this.getAttribute('data-slot-id'),
                slotLabel: this.getAttribute('data-slot-label')
              }, '*');
            });
          });
        });
      </script>
    `;

    // Inject before closing body tag
    html = html.replace('</body>', scriptInjection + '</body>');

    // Set headers to allow iframe embedding
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://safewebedit.com");
    
    res.send(html);

  } catch (error) {
    console.error('[VISUAL-EDITOR] Proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to load page',
      details: error.message 
    });
  }
});

