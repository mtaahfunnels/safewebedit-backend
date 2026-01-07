// Auto-insert slot marker into WordPress when slot is created
// This eliminates manual copy/paste

const axios = require('axios');

async function autoInsertMarker(wpUrl, wpUser, wpPass, pageId, markerName, slotLabel) {
  try {
    const auth = { username: wpUser, password: wpPass };
    
    // Get current page content
    const pageResponse = await axios.get(
      `${wpUrl}/wp-json/wp/v2/pages/${pageId}`,
      { auth }
    );
    
    let content = pageResponse.data.content.rendered;
    
    // Check if marker already exists
    const markerStart = `<!-- SLOT_START:${markerName} -->`;
    const markerEnd = `<!-- SLOT_END:${markerName} -->`;
    
    if (content.includes(markerStart)) {
      return {
        success: false,
        error: 'Marker already exists in page'
      };
    }
    
    // Insert marker at the end of content
    const markerBlock = `

<!-- SLOT_START:${markerName} -->
<div class="auto-slot" data-slot="${markerName}">
  <p><em>[${slotLabel}] - Content will be synced from Google Sheets</em></p>
</div>
<!-- SLOT_END:${markerName} -->
`;
    
    content += markerBlock;
    
    // Update WordPress page
    await axios.post(
      `${wpUrl}/wp-json/wp/v2/pages/${pageId}`,
      { content },
      { auth }
    );
    
    return {
      success: true,
      message: 'Marker auto-inserted into WordPress page'
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { autoInsertMarker };
