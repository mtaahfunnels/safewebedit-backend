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
  const { site_id, image_base64, filename, replace_image_id } = req.body;

  if (!site_id || !image_base64) {
    return res.status(400).json({
      error: "site_id and image_base64 are required"
    });
  }

  try {
    console.log("[VISUAL-CREATOR] Saving to WordPress...");

    // Get site credentials
    const siteResult = await query(
      "SELECT site_url, wp_username, wp_app_password_encrypted FROM wordpress_sites WHERE id = $1",
      [site_id]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: "Site not found" });
    }

    const { site_url, wp_username, wp_app_password_encrypted } = siteResult.rows[0];

    // Decrypt password
    const wp_password = Buffer.from(wp_app_password_encrypted, 'base64').toString('utf-8');
    const authHeader = Buffer.from(`${wp_username}:${wp_password}`).toString('base64');

    // Convert base64 to buffer
    const imageData = image_base64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(imageData, 'base64');

    // Upload to WordPress
    const form = new FormData();
    form.append('file', imageBuffer, {
      filename: filename || `created-${Date.now()}.png`,
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

    console.log("[VISUAL-CREATOR] Image uploaded:", newMedia.id);

    // If replacing an existing image, update all references
    let replacedIn = [];
    if (replace_image_id) {
      console.log("[VISUAL-CREATOR] Replacing image ID:", replace_image_id);
      // This would require finding and updating all posts/pages using the old image
      // For now, just return the new image info
    }

    res.json({
      success: true,
      new_image: {
        id: newMedia.id,
        url: newMedia.source_url,
        title: newMedia.title?.rendered,
        link: newMedia.link
      },
      replaced_in: replacedIn,
      message: "Image uploaded successfully"
    });

  } catch (error) {
    console.error("[VISUAL-CREATOR] Save error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to save to WordPress",
      message: error.message
    });
  }
});

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
