const express = require("express");
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");

/**
 * Platform Detection API with Zone Validation
 * Detects if a website is WordPress, Shopify, Ghost, or other
 * Validates zones against actual WordPress content
 * No authentication required - used for freemium landing page
 */

// ===========================================
// POST /api/platform-detection/detect
// Detect website platform
// ===========================================
router.post("/detect", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    // Normalize URL
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    console.log("[PLATFORM-DETECTION] Analyzing:", normalizedUrl);

    const results = {
      url: normalizedUrl,
      platform: "unknown",
      version: null,
      canEdit: false,
      restApiAvailable: false,
      details: {},
    };

    // 1. Check for WordPress
    try {
      const wpResponse = await axios.get(`${normalizedUrl}/wp-json`, {
        timeout: 30000,  // Increased to 30s for slow sites
        validateStatus: (status) => status < 500,
      });

      if (wpResponse.status === 200 && wpResponse.data) {
        const wpData = wpResponse.data;

        if (wpData.name || wpData.description || wpData.url) {
          results.platform = "wordpress";
          results.version = wpData.wp_version || wpData.gmt_offset !== undefined ? "detected" : null;
          results.canEdit = true;
          results.restApiAvailable = true;
          results.details = {
            siteName: wpData.name,
            description: wpData.description,
            wpVersion: wpData.wp_version,
            restApi: `${normalizedUrl}/wp-json/wp/v2`,
          };
          console.log("[PLATFORM-DETECTION] WordPress detected:", wpData.name);
          return res.json(results);
        }
      }
    } catch (wpError) {
      // Not WordPress, continue checking
    }

    // 2. Check for Shopify
    try {
      const shopifyHeaders = await axios.head(normalizedUrl, {
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      const headers = shopifyHeaders.headers;
      if (
        headers["x-shopify-stage"] ||
        headers["x-shopify-shop-api-call-limit"] ||
        (headers["server"] && headers["server"].toLowerCase().includes("shopify"))
      ) {
        results.platform = "shopify";
        results.canEdit = true;
        results.details = {
          server: headers["server"],
          shopifyStage: headers["x-shopify-stage"],
        };
        console.log("[PLATFORM-DETECTION] Shopify detected");
        return res.json(results);
      }
    } catch (shopifyError) {
      // Not Shopify, continue
    }

    // 3. Check for Ghost
    try {
      const ghostResponse = await axios.get(`${normalizedUrl}/ghost/api/v3/content/posts/`, {
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });

      if (ghostResponse.status === 200 || ghostResponse.status === 401) {
        results.platform = "ghost";
        results.canEdit = true;
        results.details = {
          apiEndpoint: `${normalizedUrl}/ghost/api/v3/admin`,
        };
        console.log("[PLATFORM-DETECTION] Ghost detected");
        return res.json(results);
      }
    } catch (ghostError) {
      // Not Ghost, continue
    }

    // 4. Check HTML source for clues
    try {
      const htmlResponse = await axios.get(normalizedUrl, {
        timeout: 20000,  // Increased to 20s for slow sites
        maxContentLength: 500000, // 500KB limit
      });

      const html = htmlResponse.data.toLowerCase();

      // Check for WordPress indicators in HTML
      if (
        html.includes("/wp-content/") ||
        html.includes("/wp-includes/") ||
        html.includes("wp-json") ||
        html.includes("wordpress")
      ) {
        results.platform = "wordpress";
        results.canEdit = true;
        results.details = {
          detectedVia: "HTML content analysis",
          note: "WordPress detected but REST API may not be accessible",
        };
        console.log("[PLATFORM-DETECTION] WordPress detected via HTML");
        return res.json(results);
      }

      // Check for Shopify in HTML
      if (html.includes("shopify") || html.includes("cdn.shopify.com")) {
        results.platform = "shopify";
        results.canEdit = true;
        results.details = {
          detectedVia: "HTML content analysis",
        };
        console.log("[PLATFORM-DETECTION] Shopify detected via HTML");
        return res.json(results);
      }

      // Check for Ghost in HTML
      if (html.includes("ghost") || html.includes("ghost.io")) {
        results.platform = "ghost";
        results.canEdit = true;
        results.details = {
          detectedVia: "HTML content analysis",
        };
        console.log("[PLATFORM-DETECTION] Ghost detected via HTML");
        return res.json(results);
      }

      // Unknown platform
      results.details = {
        note: "Platform not recognized. May be custom CMS or static site.",
      };
      console.log("[PLATFORM-DETECTION] Unknown platform");

    } catch (htmlError) {
      console.error("[PLATFORM-DETECTION] HTML analysis failed:", htmlError.message);
      
      // Check if it's a timeout - provide better message
      if (htmlError.message.includes('timeout')) {
        results.platform = "unknown";
        results.canEdit = false;
        results.details = {
          error: "Site is very slow or temporarily unavailable",
          message: "This website took too long to respond. It may be experiencing high traffic or technical issues. Please try again in a few minutes.",
          suggestion: "If this persists, the site owner may need to check their hosting.",
        };
      } else {
        results.details = {
          error: "Could not analyze website",
          message: htmlError.message,
        };
      }
    }

    return res.json(results);

  } catch (error) {
    console.error("[PLATFORM-DETECTION] Error:", error.message);
    return res.status(500).json({
      error: "Platform detection failed",
      message: error.message,
    });
  }
});

// ===========================================
// POST /api/platform-detection/discover-zones
// Discover AND VALIDATE editable zones
// Only returns zones that can ACTUALLY be edited
// ===========================================
router.post("/discover-zones", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    console.log("[ZONE-VALIDATION] Starting validated zone discovery for:", normalizedUrl);

    // Step 1: Detect platform
    const platformResponse = await axios.post(
      "http://localhost:5005/api/platform-detection/detect",
      { url: normalizedUrl },
      { timeout: 10000 }
    );

    const platformData = platformResponse.data;

    if (platformData.platform !== "wordpress") {
      return res.json({
        success: false,
        platform: platformData.platform,
        message: `${platformData.platform} auto-discovery coming soon. Currently supports WordPress only.`,
        zones: [],
        subscriptionRequired: true,
      });
    }

    // Step 2: Fetch public posts from WordPress REST API to validate zones
    let editablePosts = [];
    try {
      const postsResponse = await axios.get(`${normalizedUrl}/wp-json/wp/v2/posts`, {
        timeout: 10000,
        params: {
          per_page: 10,
          _fields: "id,title,content,link",
        },
      });

      editablePosts = postsResponse.data || [];
      console.log(`[ZONE-VALIDATION] Fetched ${editablePosts.length} public posts for validation`);
    } catch (error) {
      console.error("[ZONE-VALIDATION] Could not fetch posts:", error.message);
    }

    // Also fetch pages
    let editablePages = [];
    try {
      const pagesResponse = await axios.get(`${normalizedUrl}/wp-json/wp/v2/pages`, {
        timeout: 10000,
        params: {
          per_page: 10,
          _fields: "id,title,content,link",
        },
      });

      editablePages = pagesResponse.data || [];
      console.log(`[ZONE-VALIDATION] Fetched ${editablePages.length} public pages for validation`);
    } catch (error) {
      console.error("[ZONE-VALIDATION] Could not fetch pages:", error.message);
    }

    const allEditableContent = [...editablePosts, ...editablePages];

    if (allEditableContent.length === 0) {
      return res.json({
        success: false,
        message: "Could not access WordPress content. Site may have REST API disabled or no public content.",
        zones: [],
        subscriptionRequired: true,
      });
    }

    // Step 3: Extract zones from HTML using cheerio (more targeted)
    let candidateZones = [];
    
    try {
      const htmlResponse = await axios.get(normalizedUrl, {
        timeout: 20000,  // Increased from 15s to 20s for slow sites
        maxContentLength: 1000000,
      });

      const $ = cheerio.load(htmlResponse.data);

      // Extract text from main content areas - these are most likely to be editable

    // Focus on content areas, not headers/footers
    const contentSelectors = [
      'article h1',
      'article h2',
      'article h3',
      'article p',
      'main h1',
      'main h2',
      'main h3',
      'main p',
      '.entry-content h1',
      '.entry-content h2',
      '.entry-content h3',
      '.entry-content p',
      '.post-content h1',
      '.post-content h2',
      '.post-content h3',
      '.post-content p',
      '.content h1',
      '.content h2',
      '.content h3',
      '.content p',
    ];

    contentSelectors.forEach((selector) => {
      $(selector).each((i, elem) => {
        const text = $(elem).text().trim();

        // Filter criteria
        if (
          text.length >= 20 &&  // Minimum length
          text.length <= 300 && // Maximum length
          !text.includes('<!--') &&
          /[a-zA-Z]/.test(text) // Contains letters
        ) {
          candidateZones.push({
            text: text,
            selector: selector,
          });
        }
      });
    });

    } catch (htmlError) {
      console.log("[ZONE-VALIDATION] HTML fetch failed:", htmlError.message);
      console.log("[ZONE-VALIDATION] Returning post/page count instead of specific zones");
      
      // Return success with posts/pages info even if HTML fetch failed
      return res.json({
        success: true,
        platform: "wordpress",
        canEdit: true,
        siteName: platformData.siteName,
        message: `This WordPress site has ${editablePosts.length} posts and ${editablePages.length} pages available to edit.`,
        zones: [],
        zoneCount: editablePosts.length + editablePages.length,
        subscriptionRequired: true,
        htmlFetchFailed: true,
      });
    }
    
    console.log(`[ZONE-VALIDATION] Found ${candidateZones.length} candidate zones from HTML`);

    // Step 4: Validate each zone against actual WordPress content
    const validatedZones = [];
    let zoneId = 1;

    for (const candidate of candidateZones) {
      // Check if this text appears in any editable post/page
      const foundInContent = allEditableContent.find((item) => {
        const contentText = item.content.rendered || '';
        // Strip HTML tags from WordPress content for comparison
        const strippedContent = contentText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const candidateText = candidate.text.replace(/\s+/g, ' ').trim();

        // Check if candidate text appears in this content (with some fuzzy matching)
        const searchText = candidateText.substring(0, Math.min(100, candidateText.length));
        return strippedContent.includes(searchText) || strippedContent.includes(candidate.text.substring(0, 50));
      });

      if (foundInContent) {
        validatedZones.push({
          id: `validated-zone-${zoneId}`,
          label: candidate.text.substring(0, 60) + (candidate.text.length > 60 ? "..." : ""),
          content: candidate.text,
          editable: false, // Still requires subscription
          previewOnly: true,
          validated: true, // This zone has been validated against WordPress content
          location: candidate.selector,
          foundInPost: foundInContent.id,
          postTitle: foundInContent.title.rendered,
        });
        zoneId++;

        // Limit to 20 validated zones
        if (validatedZones.length >= 20) break;
      }
    }

    console.log(`[ZONE-VALIDATION] ✅ Validated ${validatedZones.length} editable zones`);
    console.log(`[ZONE-VALIDATION] ❌ Filtered out ${candidateZones.length - validatedZones.length} non-editable zones`);

    // Fallback: If validation found 0 zones, use non-validated candidates (page builders like Divi, Elementor)
    let finalZones = validatedZones;
    let validationFallback = false;
    
    if (validatedZones.length === 0 && candidateZones.length > 0) {
      console.log(`[ZONE-FALLBACK] 🔄 Validation returned 0 zones - falling back to non-validated zones`);
      console.log(`[ZONE-FALLBACK] Site likely uses page builder (Divi, Elementor, etc.)`);
      
      validationFallback = true;
      
      // Create non-validated zones from candidates (limit to 20)
      let zoneId = 1;
      finalZones = candidateZones.slice(0, 20).map(candidate => ({
        id: `fallback-zone-${zoneId++}`,
        label: candidate.text.substring(0, 60) + (candidate.text.length > 60 ? "..." : ""),
        content: candidate.text,
        editable: false,
        previewOnly: true,
        validated: false, // Not validated - may not be editable
        location: candidate.selector,
        fallback: true, // Flag indicating this is a fallback zone
      }));
      
      console.log(`[ZONE-FALLBACK] ✅ Returning ${finalZones.length} non-validated zones`);
    }
    
    if (finalZones.length === 0) {
      return res.json({
        success: false,
        message: "Could not find editable zones in main content. Site may use custom theme or page builders.",
        zones: [],
        subscriptionRequired: true,
      });
    }

    res.json({
      success: true,
      platform: "wordpress",
      url: normalizedUrl,
      zones: finalZones,
      totalZones: finalZones.length,
      subscriptionRequired: true,
      message: "These zones have been validated and can be edited after subscription",
      validation: {
        fallbackUsed: validationFallback,
        candidatesFound: candidateZones.length,
        zonesValidated: validatedZones.length,
        validationRate: `${Math.round((validatedZones.length / candidateZones.length) * 100)}%`,
        method: "Validated against WordPress REST API content",
      },
      pricing: {
        starter: "$29/month - Edit up to 3 sites",
        pro: "$99/month - Unlimited sites",
      },
    });

  } catch (error) {
    console.error("[ZONE-VALIDATION] Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Zone discovery failed",
      message: error.message,
    });
  }
});

// ===========================================
// GET /api/platform-detection/test
// Test endpoint to verify API is working
// ===========================================
router.get("/test", (req, res) => {
  res.json({
    status: "ok",
    message: "Platform detection API is running",
    supportedPlatforms: ["wordpress", "shopify", "ghost"],
    features: ["Platform detection", "Validated zone discovery"],
  });
});

module.exports = router;
