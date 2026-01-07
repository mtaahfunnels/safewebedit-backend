#!/usr/bin/env node

/**
 * Auto-Sync Cron Job
 * Runs every 5 minutes to sync Google Sheets → WordPress
 * Zero manual intervention required
 */

const { Pool } = require('pg');
const { google } = require('googleapis');
const axios = require('axios');

const pool = new Pool({
  connectionString: 'postgresql://safewebedits_user:SafeWeb2026Edits@localhost:5432/safewebedits_db'
});

async function autoSync() {
  const client = await pool.connect();
  
  try {
    console.log('[AUTO-SYNC] Starting automated sync:', new Date().toISOString());
    
    // Get all active organizations with Google Sheets configured
    const configsResult = await client.query(
      'SELECT * FROM google_sheets_configs WHERE is_active = true'
    );
    
    if (configsResult.rows.length === 0) {
      console.log('[AUTO-SYNC] No active configs found');
      return;
    }
    
    for (const config of configsResult.rows) {
      try {
        console.log(`[AUTO-SYNC] Processing org: ${config.organization_id}`);
        
        const credentials = JSON.parse(config.credentials_json);
        
        // Initialize Google Sheets API
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        
        const sheets = google.sheets({ version: 'v4', auth });
        
        // Get all slots for this organization
        const slotsResult = await client.query(
          `SELECT cs.*, ws.url as wp_url, ws.username as wp_user, ws.app_password as wp_pass
           FROM content_slots cs
           JOIN wordpress_sites ws ON cs.wordpress_site_id = ws.id
           WHERE ws.organization_id = $1 AND cs.is_active = true`,
          [config.organization_id]
        );
        
        if (slotsResult.rows.length === 0) {
          console.log(`[AUTO-SYNC] No active slots for org ${config.organization_id}`);
          continue;
        }
        
        // Read Google Sheet
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: config.sheet_id,
          range: 'Sheet1!A:Z',
        });
        
        const rows = response.data.values || [];
        if (rows.length === 0) continue;
        
        const headers = rows[0];
        const dataRows = rows.slice(1);
        
        let updateCount = 0;
        
        // Process each slot
        for (const slot of slotsResult.rows) {
          try {
            // Find content for this slot
            const slotColumnIndex = headers.findIndex(h => 
              h.toLowerCase().includes(slot.slot_name.toLowerCase()) ||
              h.toLowerCase().includes(slot.marker_name.toLowerCase())
            );
            
            if (slotColumnIndex === -1) continue;
            
            const newContent = dataRows.map(row => row[slotColumnIndex] || '').join('<br>');
            if (!newContent) continue;
            
            // Get WordPress page
            const wpAuth = { username: slot.wp_user, password: slot.wp_pass };
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
              
              // Update WordPress
              await axios.post(
                `${slot.wp_url}/wp-json/wp/v2/pages/${slot.wp_page_id}`,
                { content },
                { auth: wpAuth }
              );
              
              updateCount++;
              console.log(`[AUTO-SYNC] ✓ Updated ${slot.slot_label}`);
            }
          } catch (err) {
            console.error(`[AUTO-SYNC] Error updating slot ${slot.slot_name}:`, err.message);
          }
        }
        
        console.log(`[AUTO-SYNC] ✓ Org ${config.organization_id}: Updated ${updateCount} slots`);
        
      } catch (err) {
        console.error(`[AUTO-SYNC] Error processing org ${config.organization_id}:`, err.message);
      }
    }
    
    console.log('[AUTO-SYNC] ✓ Sync complete\n');
    
  } catch (error) {
    console.error('[AUTO-SYNC] Fatal error:', error);
  } finally {
    client.release();
  }
}

// Run immediately if called directly
if (require.main === module) {
  autoSync()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { autoSync };
