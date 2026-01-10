const express = require("express");
const router = express.Router();
const { createCanvas, registerFont } = require("canvas");
const sharp = require("sharp");
const FormData = require("form-data");
const axios = require("axios");
const { query } = require("../../services/database");

/**
 * Visual Image Creator API
 * Create marketing images from scratch with text, backgrounds, and styling
 */

// ===========================================
// POST /api/visual-creator/create
// Generate a custom image based on design parameters
// ===========================================
router.post("/create", async (req, res) => {
  const {
    width = 800,
    height = 600,
    background,
    text,
    style
  } = req.body;

  if (!background || !text) {
    return res.status(400).json({
      error: "background and text are required"
    });
  }

  try {
    console.log("[VISUAL-CREATOR] Creating image:", { width, height, background, text });

    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Draw background
    await drawBackground(ctx, width, height, background);

    // Draw text elements
    await drawTextElements(ctx, width, height, text, style);

    // Convert to buffer
    const imageBuffer = canvas.toBuffer('image/png');

    // Optimize with sharp
    const optimizedBuffer = await sharp(imageBuffer)
      .png({ quality: 90, compressionLevel: 9 })
      .toBuffer();

    // Return as base64
    const base64Image = optimizedBuffer.toString('base64');

    res.json({
      success: true,
      image: `data:image/png;base64,${base64Image}`,
      width: width,
      height: height,
      size: optimizedBuffer.length
    });

  } catch (error) {
    console.error("[VISUAL-CREATOR] Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Image creation failed",
      message: error.message
    });
  }
});

// ===========================================
// POST /api/visual-creator/save-to-wordpress
// Save created image to WordPress media library
// ===========================================
router.post("/save-to-wordpress", async (req, res) => {
  const { site_id, image_base64, filename, replace_image_url, page_id, target_width, target_height } = req.body;

  console.log("\n" + "=".repeat(80));
  console.log("[IMG-SWAP] REQUEST START");
  console.log("[IMG-SWAP] Time:", new Date().toISOString());
  console.log("[IMG-SWAP] site_id:", site_id);
  console.log("[IMG-SWAP] page_id:", page_id);
  console.log("[IMG-SWAP] replace_url:", replace_image_url);
  console.log("[IMG-SWAP] image_size:", image_base64 ? image_base64.length : 0);

  if (!site_id || !image_base64) {
    console.error("[IMG-SWAP] FAIL: Missing parameters");
    return res.status(400).json({ error: "site_id and image_base64 required" });
  }

  try {
    console.log("[IMG-SWAP] [1/5] Fetching site...");
    const siteResult = await query(
      "SELECT site_url, wp_username, wp_app_password_encrypted FROM wordpress_sites WHERE id = $1",
      [site_id]
    );

    if (siteResult.rows.length === 0) {
      console.error("[IMG-SWAP] FAIL: Site not found");
      return res.status(404).json({ error: "Site not found" });
    }

    const { site_url, wp_username, wp_app_password_encrypted } = siteResult.rows[0];
    console.log("[IMG-SWAP] OK: Site =", site_url);

    console.log("[IMG-SWAP] [2/5] Preparing auth...");
    const wp_password = Buffer.from(wp_app_password_encrypted, 'base64').toString('utf-8');
    const authHeader = Buffer.from(`${wp_username}:${wp_password}`).toString('base64');
    console.log("[IMG-SWAP] OK: Auth ready");

    console.log("[IMG-SWAP] [3/5] Uploading image...");
    const imageData = image_base64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(imageData, 'base64');

    // Auto-resize image if target dimensions provided
    let finalImageBuffer = imageBuffer;
    if (target_width && target_height) {
      console.log("[IMG-SWAP]   Auto-resize: Target dimensions", target_width, "x", target_height);
      try {
        finalImageBuffer = await sharp(imageBuffer)
          .resize(target_width, target_height, {
            fit: 'cover',        // Crop to fill exact dimensions
            position: 'center'   // Center crop
          })
          .png()                 // Convert to PNG
          .toBuffer();
        console.log("[IMG-SWAP]   Auto-resize: ✓ Complete");
      } catch (resizeErr) {
        console.log("[IMG-SWAP]   Auto-resize: Failed, using original", resizeErr.message);
        // Continue with original if resize fails
      }
    }


    const form = new FormData();
    form.append('file', finalImageBuffer, {
      filename: filename || `ai-${Date.now()}.png`,
      contentType: 'image/png'
    });

    const uploadResponse = await axios.post(
      `${site_url}/wp-json/wp/v2/media`,
      form,
      {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          ...form.getHeaders()
        },
        timeout: 30000,
        maxBodyLength: 10000000
      }
    );

    const newMedia = uploadResponse.data;
    console.log("[IMG-SWAP] OK: Upload complete");
    console.log("[IMG-SWAP]   ID:", newMedia.id);
    console.log("[IMG-SWAP]   URL:", newMedia.source_url);

    let replacedIn = [];
    if (replace_image_url && page_id) {
      console.log("[IMG-SWAP] [4/5] Replacing in content...");
      console.log("[IMG-SWAP]   Page:", page_id);
      console.log("[IMG-SWAP]   Find:", replace_image_url);
      console.log("[IMG-SWAP]   Replace with:", newMedia.source_url);

      try {
        const pageResp = await axios.get(
          `${site_url}/wp-json/wp/v2/pages/${page_id}?context=edit`,
          {
            headers: { 'Authorization': `Basic ${authHeader}` },
            timeout: 30000
          }
        );

        const rawContent = pageResp.data.content.raw || pageResp.data.content.rendered;
        console.log("[IMG-SWAP] OK: Page fetched, length:", rawContent.length);

        const urlExists = rawContent.includes(replace_image_url);
        console.log("[IMG-SWAP]   URL exists in content:", urlExists);

        if (!urlExists) {
          console.warn("[IMG-SWAP] WARN: URL not found!");
          console.warn("[IMG-SWAP]   Preview:", rawContent.substring(0, 200));
        }

        const updatedContent = rawContent.split(replace_image_url).join(newMedia.source_url);
        const changed = rawContent !== updatedContent;
        console.log("[IMG-SWAP]   Changed:", changed);

        if (changed) {
          console.log("[IMG-SWAP] [5/5] Saving to WordPress...");
          const updateResp = await axios.post(
            `${site_url}/wp-json/wp/v2/pages/${page_id}`,
            { content: updatedContent },
            {
              headers: {
                'Authorization': `Basic ${authHeader}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000
            }
          );

          console.log("[IMG-SWAP] OK: Saved! Modified:", updateResp.data.modified);
          replacedIn.push({
            page_id: page_id,
            old_url: replace_image_url,
            new_url: newMedia.source_url
          });
        } else {
          console.warn("[IMG-SWAP] WARN: No replacement made");
        }
      } catch (err) {
        console.error("[IMG-SWAP] ERROR in replacement:", err.message);
        if (err.response) {
          console.error("[IMG-SWAP]   Status:", err.response.status);
          console.error("[IMG-SWAP]   Data:", err.response.data);
        }
      }
    }

    console.log("[IMG-SWAP] SUCCESS");
    console.log("=".repeat(80) + "\n");

    res.json({
      success: true,
      new_image: {
        id: newMedia.id,
        url: newMedia.source_url,
        title: newMedia.title?.rendered
      },
      replaced_in: replacedIn,
      message: replacedIn.length > 0 ? "Replaced" : "Uploaded only"
    });

  } catch (error) {
    console.error("[IMG-SWAP] FATAL ERROR");
    console.error("[IMG-SWAP]   Message:", error.message);
    if (error.response) {
      console.error("[IMG-SWAP]   Status:", error.response.status);
      console.error("[IMG-SWAP]   Data:", error.response.data);
    }
    console.error("=".repeat(80) + "\n");

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
})

// ===========================================
// GET /api/visual-creator/templates
// Get pre-made templates for quick creation
// ===========================================
router.get("/templates", (req, res) => {
  const templates = [
    {
      id: "hero-blue",
      name: "Blue Hero Banner",
      width: 1200,
      height: 600,
      background: {
        type: "gradient",
        colors: ["#1e3a8a", "#3b82f6"]
      },
      text: {
        main: {
          content: "Your Headline Here",
          font: "Arial",
          size: 72,
          color: "#ffffff",
          position: "center",
          bold: true
        }
      }
    },
    {
      id: "cta-green",
      name: "Green Call-to-Action",
      width: 800,
      height: 400,
      background: {
        type: "solid",
        color: "#059669"
      },
      text: {
        main: {
          content: "Get Started Today",
          font: "Arial",
          size: 60,
          color: "#ffffff",
          position: "center",
          bold: true
        },
        subtitle: {
          content: "No credit card required",
          font: "Arial",
          size: 24,
          color: "#d1fae5",
          position: "bottom"
        }
      }
    },
    {
      id: "promo-red",
      name: "Red Promotional Banner",
      width: 1000,
      height: 300,
      background: {
        type: "gradient",
        colors: ["#dc2626", "#ef4444"]
      },
      text: {
        main: {
          content: "50% OFF SALE",
          font: "Arial",
          size: 80,
          color: "#ffffff",
          position: "center",
          bold: true,
          shadow: true
        }
      }
    },
    {
      id: "feature-gray",
      name: "Feature Highlight",
      width: 800,
      height: 500,
      background: {
        type: "solid",
        color: "#f3f4f6"
      },
      text: {
        main: {
          content: "New Feature",
          font: "Arial",
          size: 56,
          color: "#1f2937",
          position: "top",
          bold: true
        },
        subtitle: {
          content: "Discover what's possible",
          font: "Arial",
          size: 32,
          color: "#6b7280",
          position: "center"
        }
      }
    }
  ];

  res.json({
    success: true,
    templates: templates
  });
});

// ===========================================
// Helper Functions
// ===========================================

async function drawBackground(ctx, width, height, background) {
  if (background.type === 'solid') {
    // Solid color
    ctx.fillStyle = background.color || '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  else if (background.type === 'gradient') {
    // Linear gradient
    const colors = background.colors || ['#3b82f6', '#8b5cf6'];
    const angle = background.angle || 'vertical'; // horizontal, vertical, diagonal

    let gradient;
    if (angle === 'horizontal') {
      gradient = ctx.createLinearGradient(0, 0, width, 0);
    } else if (angle === 'diagonal') {
      gradient = ctx.createLinearGradient(0, 0, width, height);
    } else {
      gradient = ctx.createLinearGradient(0, 0, 0, height);
    }

    colors.forEach((color, index) => {
      gradient.addColorStop(index / (colors.length - 1), color);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  else if (background.type === 'pattern') {
    // Simple pattern (dots, stripes, etc.)
    ctx.fillStyle = background.baseColor || '#f3f4f6';
    ctx.fillRect(0, 0, width, height);

    // Add pattern
    if (background.pattern === 'dots') {
      ctx.fillStyle = background.patternColor || '#d1d5db';
      const spacing = 40;
      for (let x = 0; x < width; x += spacing) {
        for (let y = 0; y < height; y += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

async function drawTextElements(ctx, width, height, textConfig, styleConfig = {}) {
  // Handle multiple text elements
  const elements = Array.isArray(textConfig) ? textConfig : [textConfig];

  for (const element of elements) {
    const {
      content = '',
      font = 'Arial',
      size = 48,
      color = '#000000',
      position = 'center',
      bold = false,
      shadow = false,
      align = 'center'
    } = element;

    // Set font
    const fontWeight = bold ? 'bold' : 'normal';
    ctx.font = `${fontWeight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;

    // Calculate position
    let x, y;

    if (position === 'center') {
      x = width / 2;
      y = height / 2;
      ctx.textBaseline = 'middle';
    } else if (position === 'top') {
      x = width / 2;
      y = height * 0.2;
      ctx.textBaseline = 'top';
    } else if (position === 'bottom') {
      x = width / 2;
      y = height * 0.8;
      ctx.textBaseline = 'bottom';
    } else if (typeof position === 'object') {
      x = position.x || width / 2;
      y = position.y || height / 2;
      ctx.textBaseline = 'middle';
    } else {
      x = width / 2;
      y = height / 2;
      ctx.textBaseline = 'middle';
    }

    // Add shadow if specified
    if (shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
    }

    // Draw text
    ctx.fillText(content, x, y);

    // Reset shadow
    if (shadow) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }
}

// ===========================================
// GET /api/visual-creator/test
// Test endpoint
// ===========================================
router.get("/test", (req, res) => {
  res.json({
    status: "ok",
    message: "Visual Image Creator API is running",
    features: [
      "Create custom images with backgrounds",
      "Add text with custom styling",
      "Pre-made templates",
      "Direct WordPress upload",
      "Replace existing images"
    ]
  });
});

module.exports = router;

// ===========================================
// DIAGNOSTIC ENDPOINT: Test each step
// ===========================================
router.post("/diagnose-swap", async (req, res) => {
  const { site_id, page_id, replace_image_url } = req.body;

  const diagnostics = {
    timestamp: new Date().toISOString(),
    steps: [],
    success: false,
    error: null
  };

  try {
    // STEP 1: Validate inputs
    diagnostics.steps.push({
      step: 1,
      name: "Validate Inputs",
      status: "checking",
      data: { site_id, page_id, replace_image_url }
    });

    if (!site_id || !page_id || !replace_image_url) {
      diagnostics.steps[0].status = "failed";
      diagnostics.steps[0].error = "Missing required parameters";
      return res.json(diagnostics);
    }
    diagnostics.steps[0].status = "passed";

    // STEP 2: Get site credentials
    diagnostics.steps.push({
      step: 2,
      name: "Fetch Site Credentials",
      status: "checking"
    });

    const siteResult = await query(
      "SELECT site_url, wp_username, wp_app_password_encrypted FROM wordpress_sites WHERE id = $1",
      [site_id]
    );

    if (siteResult.rows.length === 0) {
      diagnostics.steps[1].status = "failed";
      diagnostics.steps[1].error = "Site not found in database";
      return res.json(diagnostics);
    }

    const { site_url, wp_username, wp_app_password_encrypted } = siteResult.rows[0];
    diagnostics.steps[1].status = "passed";
    diagnostics.steps[1].data = { site_url, wp_username };

    // STEP 3: Test WordPress authentication
    diagnostics.steps.push({
      step: 3,
      name: "Test WordPress API Authentication",
      status: "checking"
    });

    const wp_password = Buffer.from(wp_app_password_encrypted, 'base64').toString('utf-8');
    const authHeader = Buffer.from(`${wp_username}:${wp_password}`).toString('base64');

    try {
      const authTest = await axios.get(
        `${site_url}/wp-json/wp/v2/pages/${page_id}?context=edit`,
        {
          headers: { 'Authorization': `Basic ${authHeader}` },
          timeout: 10000
        }
      );
      diagnostics.steps[2].status = "passed";
      diagnostics.steps[2].data = {
        page_title: authTest.data.title?.rendered,
        page_status: authTest.data.status
      };
    } catch (authError) {
      diagnostics.steps[2].status = "failed";
      diagnostics.steps[2].error = authError.message;
      diagnostics.steps[2].details = authError.response?.data;
      return res.json(diagnostics);
    }

    // STEP 4: Fetch current page content
    diagnostics.steps.push({
      step: 4,
      name: "Fetch Current Page Content",
      status: "checking"
    });

    const pageResponse = await axios.get(
      `${site_url}/wp-json/wp/v2/pages/${page_id}`,
      {
        headers: { 'Authorization': `Basic ${authHeader}` },
        timeout: 30000
      }
    );

    const currentContent = pageResponse.data.content.rendered;
    diagnostics.steps[3].status = "passed";
    diagnostics.steps[3].data = {
      content_length: currentContent.length,
      content_preview: currentContent.substring(0, 200) + "...",
      contains_target_url: currentContent.includes(replace_image_url)
    };

    // STEP 5: Check if target image URL exists in content
    diagnostics.steps.push({
      step: 5,
      name: "Verify Target Image in Content",
      status: "checking"
    });

    if (!currentContent.includes(replace_image_url)) {
      diagnostics.steps[4].status = "warning";
      diagnostics.steps[4].error = "Target image URL not found in page content";
      diagnostics.steps[4].data = {
        searched_for: replace_image_url,
        suggestion: "The image might be in a different format or the URL might have changed"
      };

      // Try to find similar URLs
      const imgMatches = currentContent.match(/src="([^"]*\.(?:jpg|jpeg|png|gif|webp))"/gi);
      if (imgMatches) {
        diagnostics.steps[4].data.found_images = imgMatches.slice(0, 5);
      }
    } else {
      diagnostics.steps[4].status = "passed";
      const occurrences = currentContent.split(replace_image_url).length - 1;
      diagnostics.steps[4].data = {
        occurrences: occurrences,
        message: `Found ${occurrences} occurrence(s) of target URL`
      };
    }

    // STEP 6: Simulate content replacement
    diagnostics.steps.push({
      step: 6,
      name: "Simulate Content Replacement",
      status: "checking"
    });

    const testNewUrl = "https://example.com/test-new-image.png";
    const simulatedContent = currentContent.split(replace_image_url).join(testNewUrl);

    diagnostics.steps[5].status = "passed";
    diagnostics.steps[5].data = {
      original_length: currentContent.length,
      new_length: simulatedContent.length,
      changed: currentContent !== simulatedContent,
      preview: simulatedContent.substring(0, 200) + "..."
    };

    diagnostics.success = true;
    res.json(diagnostics);

  } catch (error) {
    diagnostics.error = error.message;
    diagnostics.stack = error.stack;
    res.status(500).json(diagnostics);
  }
});
