const express = require("express");
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");
const { query } = require("../../services/database");

/**
 * Image Overlay API
 * Add/edit HTML text overlays on images in WordPress sites
 */

// ===========================================
// POST /api/image-overlay/detect
// Detect images on a WordPress page
// ===========================================
router.post("/detect", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    console.log("[IMAGE-OVERLAY] Detecting images on:", normalizedUrl);

    // Fetch page HTML
    const response = await axios.get(normalizedUrl, {
      timeout: 15000,
      maxContentLength: 2000000, // 2MB limit
    });

    const $ = cheerio.load(response.data);

    // Find all images in main content areas
    const images = [];
    let imageId = 1;

    // Focus on content areas where images are likely to be editable
    const contentSelectors = [
      'article img',
      'main img',
      '.entry-content img',
      '.post-content img',
      '.content img',
      '.page-content img',
    ];

    // Also check for common image containers
    contentSelectors.forEach(selector => {
      $(selector).each((i, elem) => {
        const $img = $(elem);
        const src = $img.attr('src');
        const alt = $img.attr('alt') || '';
        const width = $img.attr('width') || 'auto';
        const height = $img.attr('height') || 'auto';

        // Get parent classes for context
        const $parent = $img.parent();
        const parentClasses = $parent.attr('class') || '';
        const parentTag = $parent.prop('tagName') ? $parent.prop('tagName').toLowerCase() : 'div';

        // Skip if no src
        if (!src) return;

        // Skip tiny images (likely icons)
        if (width !== 'auto' && height !== 'auto') {
          const w = parseInt(width);
          const h = parseInt(height);
          if ((w < 100 && h < 100) || w < 50 || h < 50) {
            return;
          }
        }

        // Create unique selector
        const imgClasses = $img.attr('class') || '';
        let uniqueSelector = selector;
        if (imgClasses) {
          uniqueSelector = `img.${imgClasses.split(' ').join('.')}`;
        } else if (alt) {
          uniqueSelector = `img[alt="${alt}"]`;
        } else {
          uniqueSelector = `img[src*="${src.split('/').pop()}"]`;
        }

        images.push({
          id: `img-${imageId++}`,
          src: src.startsWith('http') ? src : new URL(src, normalizedUrl).href,
          alt: alt,
          width: width,
          height: height,
          selector: uniqueSelector,
          context: {
            parentTag: parentTag,
            parentClasses: parentClasses,
          },
          hasOverlay: false, // Will check this later
        });
      });
    });

    // Remove duplicates based on src
    const uniqueImages = images.reduce((acc, img) => {
      if (!acc.find(i => i.src === img.src)) {
        acc.push(img);
      }
      return acc;
    }, []);

    console.log(`[IMAGE-OVERLAY] Found ${uniqueImages.length} images`);

    res.json({
      success: true,
      url: normalizedUrl,
      images: uniqueImages,
      totalImages: uniqueImages.length,
    });

  } catch (error) {
    console.error("[IMAGE-OVERLAY] Detection error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Image detection failed",
      message: error.message,
    });
  }
});

// ===========================================
// POST /api/image-overlay/save
// Save text overlay to an image in WordPress
// ===========================================
router.post("/save", async (req, res) => {
  const { site_id, page_id, image_src, overlay } = req.body;

  if (!site_id || !page_id || !image_src || !overlay) {
    return res.status(400).json({
      error: "Missing required fields: site_id, page_id, image_src, overlay"
    });
  }

  try {
    console.log("[IMAGE-OVERLAY] Saving overlay for image:", image_src);

    // Get site credentials from database
    const siteResult = await query(
      "SELECT site_url, wp_username, wp_app_password FROM wordpress_sites WHERE id = $1",
      [site_id]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: "Site not found" });
    }

    const { site_url, wp_username, wp_app_password } = siteResult.rows[0];

    // Create Basic Auth header
    const authHeader = Buffer.from(`${wp_username}:${wp_app_password}`).toString('base64');

    // Fetch current page content from WordPress
    const wpEndpoint = `${site_url}/wp-json/wp/v2/pages/${page_id}`;

    const pageResponse = await axios.get(wpEndpoint, {
      headers: {
        'Authorization': `Basic ${authHeader}`,
      },
      timeout: 10000,
    });

    const currentContent = pageResponse.data.content.rendered;
    console.log("[IMAGE-OVERLAY] Fetched current page content");

    // Parse HTML and find the target image
    const $ = cheerio.load(currentContent);

    // Find image by src (handle both absolute and relative URLs)
    let $targetImg = null;
    $('img').each((i, elem) => {
      const imgSrc = $(elem).attr('src');
      if (imgSrc && (imgSrc === image_src || imgSrc.includes(image_src) || image_src.includes(imgSrc))) {
        $targetImg = $(elem);
        return false; // break
      }
    });

    if (!$targetImg) {
      return res.status(404).json({
        error: "Image not found in page content",
        detail: `Could not find image with src: ${image_src}`
      });
    }

    console.log("[IMAGE-OVERLAY] Found target image");

    // Check if image is already wrapped in overlay container
    const $parent = $targetImg.parent();
    const isWrapped = $parent.hasClass('swe-image-overlay-container');

    // Build overlay HTML
    const position = overlay.position || 'center';
    const fontSize = overlay.style?.fontSize || '32px';
    const color = overlay.style?.color || '#ffffff';
    const backgroundColor = overlay.style?.backgroundColor || 'rgba(0,0,0,0.5)';
    const padding = overlay.style?.padding || '20px';

    // Position mapping
    const positionStyles = {
      'top-left': 'top: 10%; left: 10%;',
      'top-center': 'top: 10%; left: 50%; transform: translateX(-50%);',
      'top-right': 'top: 10%; right: 10%;',
      'center': 'top: 50%; left: 50%; transform: translate(-50%, -50%);',
      'bottom-left': 'bottom: 10%; left: 10%;',
      'bottom-center': 'bottom: 10%; left: 50%; transform: translateX(-50%);',
      'bottom-right': 'bottom: 10%; right: 10%;',
    };

    const overlayStyle = `position: absolute; ${positionStyles[position] || positionStyles.center} font-size: ${fontSize}; color: ${color}; background-color: ${backgroundColor}; padding: ${padding}; border-radius: 4px; text-shadow: 2px 2px 4px rgba(0,0,0,0.7);`;

    const overlayHtml = `<div class="swe-text-overlay" style="${overlayStyle}">${overlay.text}</div>`;

    if (isWrapped) {
      // Update existing overlay or add new one
      const $existingOverlay = $parent.find('.swe-text-overlay');
      if ($existingOverlay.length > 0) {
        $existingOverlay.replaceWith(overlayHtml);
        console.log("[IMAGE-OVERLAY] Updated existing overlay");
      } else {
        $parent.append(overlayHtml);
        console.log("[IMAGE-OVERLAY] Added overlay to existing container");
      }
    } else {
      // Wrap image in container and add overlay
      const containerHtml = `<div class="swe-image-overlay-container" style="position: relative; display: inline-block;">${$targetImg.toString()}${overlayHtml}</div>`;
      $targetImg.replaceWith(containerHtml);
      console.log("[IMAGE-OVERLAY] Wrapped image and added overlay");
    }

    // Get modified HTML
    const modifiedContent = $.html();

    // Save back to WordPress
    const updateResponse = await axios.post(wpEndpoint, {
      content: modifiedContent,
    }, {
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    console.log("[IMAGE-OVERLAY] Successfully saved overlay to WordPress");

    res.json({
      success: true,
      message: "Text overlay saved successfully",
      page_id: page_id,
      image_src: image_src,
      overlay: overlay,
      wp_response: {
        id: updateResponse.data.id,
        modified: updateResponse.data.modified,
        link: updateResponse.data.link,
      },
    });

  } catch (error) {
    console.error("[IMAGE-OVERLAY] Save error:", error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        error: "WordPress API error",
        message: error.response.data?.message || error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to save overlay",
      message: error.message,
    });
  }
});

// ===========================================
// GET /api/image-overlay/list/:site_id/:page_id
// List existing overlays on a page
// ===========================================
router.get("/list/:site_id/:page_id", async (req, res) => {
  const { site_id, page_id } = req.params;

  try {
    console.log(`[IMAGE-OVERLAY] Listing overlays for site ${site_id}, page ${page_id}`);

    // Get site credentials
    const siteResult = await query(
      "SELECT site_url, wp_username, wp_app_password FROM wordpress_sites WHERE id = $1",
      [site_id]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: "Site not found" });
    }

    const { site_url, wp_username, wp_app_password } = siteResult.rows[0];
    const authHeader = Buffer.from(`${wp_username}:${wp_app_password}`).toString('base64');

    // Fetch page content
    const wpEndpoint = `${site_url}/wp-json/wp/v2/pages/${page_id}`;
    const pageResponse = await axios.get(wpEndpoint, {
      headers: { 'Authorization': `Basic ${authHeader}` },
      timeout: 10000,
    });

    const content = pageResponse.data.content.rendered;
    const $ = cheerio.load(content);

    // Find all images with overlays
    const overlays = [];
    $('.swe-image-overlay-container').each((i, container) => {
      const $container = $(container);
      const $img = $container.find('img');
      const $overlay = $container.find('.swe-text-overlay');

      if ($img.length > 0 && $overlay.length > 0) {
        overlays.push({
          id: `overlay-${i + 1}`,
          image_src: $img.attr('src'),
          image_alt: $img.attr('alt') || '',
          overlay_text: $overlay.text(),
          overlay_style: $overlay.attr('style'),
        });
      }
    });

    console.log(`[IMAGE-OVERLAY] Found ${overlays.length} existing overlays`);

    res.json({
      success: true,
      site_id: site_id,
      page_id: page_id,
      overlays: overlays,
      totalOverlays: overlays.length,
    });

  } catch (error) {
    console.error("[IMAGE-OVERLAY] List error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to list overlays",
      message: error.message,
    });
  }
});

// ===========================================
// DELETE /api/image-overlay/remove
// Remove text overlay from an image
// ===========================================
router.post("/remove", async (req, res) => {
  const { site_id, page_id, image_src } = req.body;

  if (!site_id || !page_id || !image_src) {
    return res.status(400).json({
      error: "Missing required fields: site_id, page_id, image_src"
    });
  }

  try {
    console.log("[IMAGE-OVERLAY] Removing overlay from image:", image_src);

    // Get site credentials
    const siteResult = await query(
      "SELECT site_url, wp_username, wp_app_password FROM wordpress_sites WHERE id = $1",
      [site_id]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: "Site not found" });
    }

    const { site_url, wp_username, wp_app_password } = siteResult.rows[0];
    const authHeader = Buffer.from(`${wp_username}:${wp_app_password}`).toString('base64');

    // Fetch current page content
    const wpEndpoint = `${site_url}/wp-json/wp/v2/pages/${page_id}`;
    const pageResponse = await axios.get(wpEndpoint, {
      headers: { 'Authorization': `Basic ${authHeader}` },
      timeout: 10000,
    });

    const currentContent = pageResponse.data.content.rendered;
    const $ = cheerio.load(currentContent);

    // Find the overlay container
    let found = false;
    $('.swe-image-overlay-container').each((i, container) => {
      const $container = $(container);
      const $img = $container.find('img');
      const imgSrc = $img.attr('src');

      if (imgSrc && (imgSrc === image_src || imgSrc.includes(image_src) || image_src.includes(imgSrc))) {
        // Unwrap: replace container with just the image
        $container.replaceWith($img.toString());
        found = true;
        return false; // break
      }
    });

    if (!found) {
      return res.status(404).json({
        error: "Overlay not found",
        detail: `No overlay found for image: ${image_src}`
      });
    }

    // Save back to WordPress
    const modifiedContent = $.html();
    await axios.post(wpEndpoint, {
      content: modifiedContent,
    }, {
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    console.log("[IMAGE-OVERLAY] Successfully removed overlay");

    res.json({
      success: true,
      message: "Text overlay removed successfully",
      page_id: page_id,
      image_src: image_src,
    });

  } catch (error) {
    console.error("[IMAGE-OVERLAY] Remove error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to remove overlay",
      message: error.message,
    });
  }
});

// ===========================================
// GET /api/image-overlay/test
// Test endpoint
// ===========================================
router.get("/test", (req, res) => {
  res.json({
    status: "ok",
    message: "Image Overlay API is running",
    endpoints: [
      "POST /api/image-overlay/detect",
      "POST /api/image-overlay/save",
      "GET /api/image-overlay/list/:site_id/:page_id",
      "POST /api/image-overlay/remove",
    ],
  });
});

module.exports = router;
