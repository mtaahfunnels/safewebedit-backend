const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const authenticateToken = require('../middleware/auth');
const db = require('../../services/database');

// ===========================================
// POST /api/google-sheets/config
// Save Google Sheets configuration
// ===========================================
router.post('/config', authenticateToken, async (req, res) => {
  try {
    const { sheet_id, sheet_name, credentials_json } = req.body;

    if (!sheet_id || !credentials_json) {
      return res.status(400).json({ error: 'sheet_id and credentials_json are required' });
    }

    // Parse and validate credentials
    let credentials;
    try {
      credentials = typeof credentials_json === 'string' 
        ? JSON.parse(credentials_json) 
        : credentials_json;
    } catch (err) {
      return res.status(400).json({ error: 'Invalid credentials JSON format' });
    }

    const service_account_email = credentials.client_email;

    // Check if config already exists
    const existing = await db.query(
      'SELECT id FROM google_sheets_configs WHERE organization_id = $1',
      [req.organizationId]
    );

    let config;
    if (existing.rows.length > 0) {
      // Update existing
      const result = await db.query(
        `UPDATE google_sheets_configs 
         SET sheet_id = $1, sheet_name = $2, service_account_email = $3, 
             credentials_json = $4, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $5
         RETURNING *`,
        [sheet_id, sheet_name, service_account_email, JSON.stringify(credentials), req.organizationId]
      );
      config = result.rows[0];
    } else {
      // Create new
      const result = await db.query(
        `INSERT INTO google_sheets_configs 
         (organization_id, sheet_id, sheet_name, service_account_email, credentials_json)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [req.organizationId, sheet_id, sheet_name, service_account_email, JSON.stringify(credentials)]
      );
      config = result.rows[0];
    }

    // Don't return credentials in response
    delete config.credentials_json;

    res.json({ config });
  } catch (error) {
    console.error('[Google Sheets] Config save error:', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// ===========================================
// GET /api/google-sheets/config
// Get Google Sheets configuration
// ===========================================
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, sheet_id, sheet_name, service_account_email, is_active, created_at FROM google_sheets_configs WHERE organization_id = $1',
      [req.organizationId]
    );

    if (result.rows.length === 0) {
      return res.json({ config: null });
    }

    res.json({ config: result.rows[0] });
  } catch (error) {
    console.error('[Google Sheets] Config get error:', error);
    res.status(500).json({ error: 'Failed to get configuration' });
  }
});

// ===========================================
// POST /api/google-sheets/sync
// Sync content from Google Sheets to WordPress
// ===========================================
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    // Get Google Sheets config
    const configResult = await db.query(
      'SELECT * FROM google_sheets_configs WHERE organization_id = $1 AND is_active = true',
      [req.organizationId]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'No Google Sheets configuration found' });
    }

    const config = configResult.rows[0];
    const credentials = JSON.parse(config.credentials_json);

    // Initialize Google Sheets API
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Get all slots for this organization
    const slotsResult = await db.query(
      `SELECT cs.*, ws.url as wp_url, ws.username as wp_user, ws.app_password as wp_pass
       FROM content_slots cs
       JOIN wordpress_sites ws ON cs.wordpress_site_id = ws.id
       WHERE ws.organization_id = $1 AND cs.is_active = true`,
      [req.organizationId]
    );

    if (slotsResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active slots found' });
    }

    // Read Google Sheet data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.sheet_id,
      range: 'Sheet1!A:Z', // Read all columns
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Sheet is empty' });
    }

    // First row is headers
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Process each slot
    const axios = require('axios');
    const updates = [];

    for (const slot of slotsResult.rows) {
      try {
        // Find content for this slot in sheet
        const slotColumnIndex = headers.findIndex(h => 
          h.toLowerCase().includes(slot.slot_name.toLowerCase()) ||
          h.toLowerCase().includes(slot.marker_name.toLowerCase())
        );

        if (slotColumnIndex === -1) continue;

        const newContent = dataRows.map(row => row[slotColumnIndex] || '').join('<br>');

        if (!newContent) continue;

        // Get WordPress page
        const wpAuth = {
          username: slot.wp_user,
          password: slot.wp_pass
        };

        const pageResponse = await axios.get(
          `${slot.wp_url}/wp-json/wp/v2/pages/${slot.wp_page_id}`,
          { auth: wpAuth }
        );

        let content = pageResponse.data.content.rendered;

        // Replace content between markers
        const startMarker = `<!-- SLOT_START:${slot.marker_name} -->`;
        const endMarker = `<!-- SLOT_END:${slot.marker_name} -->`;

        if (content.includes(startMarker)) {
          const regex = new RegExp(`${startMarker}[\s\S]*?${endMarker}`, 'g');
          content = content.replace(regex, `${startMarker}${newContent}${endMarker}`);

          // Update WordPress page
          await axios.post(
            `${slot.wp_url}/wp-json/wp/v2/pages/${slot.wp_page_id}`,
            { content },
            { auth: wpAuth }
          );

          updates.push({
            slot: slot.slot_label,
            page: slot.wp_page_title,
            status: 'updated'
          });
        }
      } catch (err) {
        console.error(`Error updating slot ${slot.slot_name}:`, err.message);
        updates.push({
          slot: slot.slot_label,
          page: slot.wp_page_title,
          status: 'failed',
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      updates,
      totalSlots: slotsResult.rows.length,
      updated: updates.filter(u => u.status === 'updated').length,
      failed: updates.filter(u => u.status === 'failed').length
    });

  } catch (error) {
    console.error('[Google Sheets] Sync error:', error);
    res.status(500).json({ error: error.message || 'Sync failed' });
  }
});

module.exports = router;
