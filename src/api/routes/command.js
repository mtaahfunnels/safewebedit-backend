const express = require('express');
const router = express.Router();
const db = require('../../services/database');
const creditService = require('../../services/creditService');
const axios = require('axios');

router.post('/', async (req, res) => {
  try {
    const { command, site_id } = req.body;
    console.log('[COMMAND] Received:', command, 'for site:', site_id);

    if (!command || !site_id) {
      return res.status(400).json({ success: false, message: 'Command and site_id required' });
    }

    const query = `
      SELECT cs.*, ws.site_url, ws.wp_username, ws.wp_app_password_encrypted, ws.site_name
      FROM content_slots cs
      JOIN wordpress_sites ws ON cs.wordpress_site_id = ws.id  
      WHERE cs.wordpress_site_id = $1
      ORDER BY cs.created_at DESC
    `;

    const result = await db.query(query, [site_id]);
    const zones = result.rows;

    if (zones.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No editable zones found. Use Visual Editor to create zones first.' 
      });
    }

    console.log('[COMMAND] Found', zones.length, 'zones');

    // Check credits (1 credit needed for text edit via command)
    const user_id = zones[0].user_id;
    console.log('[COMMAND] Checking credits for user:', user_id);
    const hasEnoughCredits = await creditService.hasCredits(user_id, 1);
    const currentBalance = await creditService.getBalance(user_id);
    console.log('[COMMAND] Current balance:', currentBalance);

    if (!hasEnoughCredits) {
      console.error('[COMMAND] FAIL: Insufficient credits');
      console.error('[COMMAND]   Required: 1, Available:', currentBalance);
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        required: 1,
        available: currentBalance,
        message: 'You need 1 credit to edit text. Please purchase more credits.'
      });
    }
    console.log('[COMMAND] OK: Credits sufficient');

    const parsedCommand = parseCommand(command, zones);
    if (!parsedCommand.valid) {
      return res.status(400).json({ success: false, message: parsedCommand.error });
    }

    const updateResult = await executeUpdate(parsedCommand);

    // Deduct 1 credit for text edit
    const newBalance = await creditService.useCredits(user_id, 1, 'AI Command: ' + command.substring(0, 50));
    console.log('[COMMAND] Deducted 1 credit, new balance:', newBalance);
    
    res.json({
      success: true,
      message: updateResult.message,
      changes: updateResult.changes,
      credits: {
        used: 1,
        balance: newBalance
      }
    });

  } catch (error) {
    console.error('[COMMAND] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

function parseCommand(command, zones) {
  const lower = command.toLowerCase();

  if (!lower.includes('change') && !lower.includes('update')) {
    return { valid: false, error: 'Command must start with "change" or "update"' };
  }

  let targetZone = null;
  for (const zone of zones) {
    const name = (zone.slot_label || zone.marker_name || '').toLowerCase();
    if (lower.includes('hero') && name.includes('hero')) { targetZone = zone; break; }
    if (lower.includes('title') && name.includes('title')) { targetZone = zone; break; }
    if (lower.includes('headline') && name.includes('title')) { targetZone = zone; break; }
  }

  if (!targetZone) {
    const available = zones.map(z => z.slot_label || z.marker_name).join(', ');
    return { valid: false, error: 'Could not find zone. Available: ' + available };
  }

  const toIndex = lower.indexOf(' to ');
  if (toIndex === -1) {
    return { valid: false, error: 'Use format: "change [zone] to [new text]"' };
  }

  const newContent = command.substring(toIndex + 4).trim().replace(/^['"]|['"]$/g, '');
  
  return {
    valid: true,
    zone: targetZone,
    newContent: newContent
  };
}

async function executeUpdate(parsed) {
  const zone = parsed.zone;
  const content = parsed.newContent;

  if (content.includes('<script>')) {
    throw new Error('Scripts not allowed for safety');
  }

  const password = Buffer.from(zone.wp_app_password_encrypted, 'base64').toString('utf-8');
  const auth = Buffer.from(zone.wp_username + ':' + password).toString('base64');
  const endpoint = zone.section_type === 'page' ? 'pages' : 'posts';
  const url = zone.site_url + '/wp-json/wp/v2/' + endpoint + '/' + zone.wp_page_id;

  await axios.post(url, { content: content }, {
    headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' },
    timeout: 15000
  });

  await db.query(
    'UPDATE content_slots SET current_content = $1, last_updated = NOW() WHERE id = $2',
    [content, zone.id]
  );

  return {
    message: 'Changed "' + (zone.slot_label || zone.marker_name) + '" successfully',
    changes: [
      'Zone: ' + (zone.slot_label || zone.marker_name),
      'New content: "' + content.substring(0, 80) + '..."'
    ]
  };
}

module.exports = router;
