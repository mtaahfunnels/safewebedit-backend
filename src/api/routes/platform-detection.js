const express = require("express");
const router = express.Router();
const axios = require("axios");

/**
 * Platform Detection API
 * Detects if a website is WordPress, Shopify, Ghost, or other
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
        timeout: 10000,
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
        timeout: 10000,
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
      results.details = {
        error: "Could not analyze website",
        message: htmlError.message,
      };
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
// GET /api/platform-detection/test
// Test endpoint to verify API is working
// ===========================================
router.get("/test", (req, res) => {
  res.json({
    status: "ok",
    message: "Platform detection API is running",
    supportedPlatforms: ["wordpress", "shopify", "ghost"],
  });
});

module.exports = router;

// ===========================================
// POST /api/platform-detection/discover-zones
// Discover editable zones on any website (public, no auth)
// Returns zones but marks them as requiring subscription
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

    console.log("[PUBLIC-DISCOVERY] Discovering zones for:", normalizedUrl);

    // First detect the platform
    const platformResponse = await axios.post(
      "http://localhost:5005/api/platform-detection/detect",
      { url: normalizedUrl }
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

    // Fetch the WordPress homepage HTML
    const htmlResponse = await axios.get(normalizedUrl, {
      timeout: 15000,
      maxContentLength: 1000000, // 1MB limit
    });

    const html = htmlResponse.data;

    // Extract text content zones (simple version - no auth needed)
    const zones = [];
    let zoneId = 1;

    // Find all text nodes between HTML tags (simplified)
    // Match patterns like: >Some text here<
    const textPattern = />([^<>{}\[\]]+)</g;
    let match;

    while ((match = textPattern.exec(html)) !== null) {
      const text = match[1].trim();

      // Filter out noise
      if (
        text.length > 15 && // Minimum length
        text.length < 200 && // Maximum length
        !text.startsWith("<!--") && // Not a comment
        !text.match(/^[^a-zA-Z0-9]+$/) && // Has alphanumeric chars
        !text.toLowerCase().includes("<!doctype") &&
        !text.toLowerCase().includes("<script") &&
        !text.toLowerCase().includes("<style")
      ) {
        zones.push({
          id: `preview-zone-${zoneId}`,
          label: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
          content: text,
          editable: false, // Requires subscription
          previewOnly: true,
          location: "auto-detected",
        });
        zoneId++;

        // Limit to 20 zones for preview
        if (zones.length >= 20) break;
      }
    }

    console.log(`[PUBLIC-DISCOVERY] Found ${zones.length} preview zones`);

    res.json({
      success: true,
      platform: "wordpress",
      url: normalizedUrl,
      zones: zones,
      totalZones: zones.length,
      subscriptionRequired: true,
      message: "Subscribe to edit these zones",
      pricing: {
        starter: "$29/month - Edit up to 3 sites",
        pro: "$99/month - Unlimited sites",
      },
    });

  } catch (error) {
    console.error("[PUBLIC-DISCOVERY] Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Zone discovery failed",
      message: error.message,
    });
  }
});

module.exports = router;
