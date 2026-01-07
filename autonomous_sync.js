/**
 * AUTONOMOUS SYNC SYSTEM
 * Demonstrates complete Google Sheets → WordPress workflow
 */

const axios = require('axios');

// Configuration
const WP_URL = 'https://workaiflow.com';
const WP_USER = 'admin';
const WP_PASS = 't9ZBteczQJYPoLHDlEgK2FvU';

// Create WordPress auth
const wpAuth = {
  username: WP_USER,
  password: WP_PASS
};

// Sample Google Sheets data (simulated)
const GOOGLE_SHEET_DATA = [
  {
    slot_id: 'HOME_SLOT_1',
    content: '<h2>Welcome to WorkAIFlow - Auto-Updated!</h2><p>This content was automatically updated by SafeWebEdit from Google Sheets at ' + new Date().toLocaleString() + '</p><p>Change the Google Sheet and click Sync to update this section instantly!</p>'
  },
  {
    slot_id: 'CHECKOUT_SLOT_1', 
    content: '<h3>Special Checkout Offer!</h3><p>Get 20% off your first order - Updated from Google Sheets!</p>'
  }
];

async function syncContent() {
  console.log('=== AUTONOMOUS SYNC STARTED ===\n');
  
  try {
    // Step 1: Get WordPress page
    console.log('STEP 1: Fetching WordPress page...');
    const pagesResponse = await axios.get(`${WP_URL}/wp-json/wp/v2/pages`, { auth: wpAuth });
    const homePage = pagesResponse.data.find(p => p.title.rendered.toLowerCase().includes('home')) || pagesResponse.data[0];
    
    console.log(`   ✓ Found: ${homePage.title.rendered} (ID: ${homePage.id})\n`);
    
    // Step 2: Get current content
    let content = homePage.content.rendered;
    console.log('STEP 2: Updating slot content from Google Sheets...');
    
    // Step 3: Replace each slot with new content from Google Sheets
    for (const row of GOOGLE_SHEET_DATA) {
      const { slot_id, content: newContent } = row;
      
      // Find the slot markers
      const startMarker = `<!-- SLOT_START:${slot_id} -->`;
      const endMarker = `<!-- SLOT_END:${slot_id} -->`;
      
      if (content.includes(startMarker)) {
        // Replace content between markers
        const regex = new RegExp(`${startMarker}[\s\S]*?${endMarker}`, 'g');
        content = content.replace(regex, `${startMarker}${newContent}${endMarker}`);
        console.log(`   ✓ Updated ${slot_id}`);
      } else {
        console.log(`   ⚠ Slot ${slot_id} not found in page`);
      }
    }
    
    // Step 4: Update WordPress page
    console.log('\nSTEP 3: Pushing updates to WordPress...');
    const updateResponse = await axios.post(
      `${WP_URL}/wp-json/wp/v2/pages/${homePage.id}`,
      { content },
      { auth: wpAuth }
    );
    
    console.log(`   ✓ WordPress updated successfully!`);
    console.log(`   ✓ View at: ${homePage.link}\n`);
    
    console.log('=== SYNC COMPLETE ===');
    console.log('Your WordPress page now shows content from Google Sheets!');
    console.log('Change the sheet data and run sync again to see instant updates.');
    
  } catch (error) {
    console.error('Sync error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.status, error.response.data);
    }
  }
}

// Run the sync
syncContent();
