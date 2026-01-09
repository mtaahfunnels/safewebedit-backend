const express = require("express");
const router = express.Router();
const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { query } = require("../../services/database");

/**
 * Image Text Replacement API
 * Detect and replace text in images using AI
 */

// ===========================================
// POST /api/image-text/detect
// Detect text in an image using OCR
// ===========================================
router.post("/detect", async (req, res) => {
  const { image_url } = req.body;

  if (!image_url) {
    return res.status(400).json({ error: "image_url is required" });
  }

  try {
    console.log("[TEXT-DETECT] Detecting text in image:", image_url);

    // Download image
    const imageResponse = await axios.get(image_url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 10000000 // 10MB
    });

    const imageBuffer = Buffer.from(imageResponse.data);

    // Use Google Cloud Vision API for OCR (requires GOOGLE_APPLICATION_CREDENTIALS env var)
    // Or fall back to Tesseract if Google credentials not available
    let textDetections = [];

    // Try Google Cloud Vision first
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_VISION_API_KEY) {
      try {
        textDetections = await detectTextWithGoogleVision(imageBuffer);
        console.log(`[TEXT-DETECT] Google Vision found ${textDetections.length} text regions`);
      } catch (visionError) {
        console.log("[TEXT-DETECT] Google Vision failed, falling back to Tesseract");
        textDetections = await detectTextWithTesseract(imageBuffer);
      }
    } else {
      // Use Tesseract as default
      textDetections = await detectTextWithTesseract(imageBuffer);
      console.log(`[TEXT-DETECT] Tesseract found ${textDetections.length} text regions`);
    }

    res.json({
      success: true,
      image_url: image_url,
      text_regions: textDetections,
      total_regions: textDetections.length,
      ocr_engine: textDetections.length > 0 ? textDetections[0].engine : 'none'
    });

  } catch (error) {
    console.error("[TEXT-DETECT] Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Text detection failed",
      message: error.message
    });
  }
});

// ===========================================
// POST /api/image-text/remove
// Remove text from image using inpainting
// ===========================================
router.post("/remove", async (req, res) => {
  const { image_url, regions } = req.body;

  if (!image_url || !regions || !Array.isArray(regions)) {
    return res.status(400).json({
      error: "image_url and regions array are required"
    });
  }

  try {
    console.log(`[TEXT-REMOVE] Removing ${regions.length} text regions from image`);

    // Download original image
    const imageResponse = await axios.get(image_url, {
      responseType: 'arraybuffer',
      timeout: 30000
    });

    const imageBuffer = Buffer.from(imageResponse.data);

    // Create mask for inpainting (white = areas to remove)
    const mask = await createMaskFromRegions(imageBuffer, regions);

    // Use ClipDrop API for inpainting
    if (process.env.CLIPDROP_API_KEY) {
      const resultBuffer = await removeTextWithClipDrop(imageBuffer, mask);

      // Return the processed image as base64
      const base64Image = resultBuffer.toString('base64');

      res.json({
        success: true,
        processed_image: `data:image/png;base64,${base64Image}`,
        regions_removed: regions.length,
        method: 'clipdrop'
      });
    } else {
      // Fall back to simple blur/patch method
      const resultBuffer = await removeTextWithSimpleMethod(imageBuffer, regions);

      const base64Image = resultBuffer.toString('base64');

      res.json({
        success: true,
        processed_image: `data:image/png;base64,${base64Image}`,
        regions_removed: regions.length,
        method: 'simple',
        note: 'Using basic removal. Set CLIPDROP_API_KEY for better results.'
      });
    }

  } catch (error) {
    console.error("[TEXT-REMOVE] Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Text removal failed",
      message: error.message
    });
  }
});

// ===========================================
// POST /api/image-text/replace
// Full pipeline: detect, remove, add new text
// ===========================================
router.post("/replace", async (req, res) => {
  const { image_url, replacements } = req.body;

  if (!image_url || !replacements || !Array.isArray(replacements)) {
    return res.status(400).json({
      error: "image_url and replacements array required"
    });
  }

  try {
    console.log(`[TEXT-REPLACE] Replacing ${replacements.length} text regions`);

    // Step 1: Download image
    const imageResponse = await axios.get(image_url, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    let imageBuffer = Buffer.from(imageResponse.data);

    // Step 2: Remove old text
    const regionsToRemove = replacements.map(r => r.region);
    const mask = await createMaskFromRegions(imageBuffer, regionsToRemove);

    if (process.env.CLIPDROP_API_KEY) {
      imageBuffer = await removeTextWithClipDrop(imageBuffer, mask);
    } else {
      imageBuffer = await removeTextWithSimpleMethod(imageBuffer, regionsToRemove);
    }

    // Step 3: Add new text
    const finalImage = await addTextToImage(imageBuffer, replacements);

    // Return processed image
    const base64Image = finalImage.toString('base64');

    res.json({
      success: true,
      processed_image: `data:image/png;base64,${base64Image}`,
      replacements_made: replacements.length,
      message: "Text replaced successfully"
    });

  } catch (error) {
    console.error("[TEXT-REPLACE] Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Text replacement failed",
      message: error.message
    });
  }
});

// ===========================================
// POST /api/image-text/save-to-wordpress
// Save processed image to WordPress media library
// ===========================================
router.post("/save-to-wordpress", async (req, res) => {
  const { site_id, processed_image_base64, filename, original_image_id } = req.body;

  if (!site_id || !processed_image_base64) {
    return res.status(400).json({
      error: "site_id and processed_image_base64 are required"
    });
  }

  try {
    console.log("[TEXT-REPLACE] Saving processed image to WordPress");

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
    const imageData = processed_image_base64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(imageData, 'base64');

    // Upload to WordPress
    const form = new FormData();
    form.append('file', imageBuffer, {
      filename: filename || `text-replaced-${Date.now()}.png`,
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

    // Optionally replace the old image in content
    let replacedInContent = false;
    if (original_image_id) {
      // This would require finding all posts/pages using the old image
      // and replacing it with the new one - complex operation
      // For now, we'll just return the new image info
    }

    res.json({
      success: true,
      new_image: {
        id: newMedia.id,
        url: newMedia.source_url,
        title: newMedia.title?.rendered,
        link: newMedia.link
      },
      message: "Image uploaded to WordPress successfully"
    });

  } catch (error) {
    console.error("[TEXT-REPLACE] WordPress upload error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to save to WordPress",
      message: error.message
    });
  }
});

// ===========================================
// Helper Functions
// ===========================================

async function detectTextWithTesseract(imageBuffer) {
  const Tesseract = require('tesseract.js');
  const sharp = require('sharp');

  try {
    console.log('[TESSERACT] Starting OCR recognition...');

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const imgWidth = metadata.width;
    const imgHeight = metadata.height;
    console.log(`[TESSERACT] Image size: ${imgWidth}x${imgHeight}`);

    const result = await Tesseract.recognize(imageBuffer, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          console.log(`[TESSERACT] Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    console.log('[TESSERACT] OCR complete. Analyzing results...');

    // Check if we have text
    if (!result || !result.data || !result.data.text) {
      console.error('[TESSERACT] No data in result');
      return [];
    }

    const detectedText = result.data.text.trim();

    if (!detectedText || detectedText.length === 0) {
      console.log('[TESSERACT] No text detected in image');
      return [];
    }

    console.log(`[TESSERACT] Detected text: "${detectedText}"`);
    console.log(`[TESSERACT] Confidence: ${result.data.confidence}%`);

    // Tesseract.js v7.0.0 doesn't provide word-level bounding boxes by default
    // Create an estimated region covering the center area where text typically appears
    const textLines = detectedText.split('\n').filter(line => line.trim().length > 0);

    return textLines.map((line, index) => {
      // Estimate text region in the center of image
      const lineHeight = Math.floor(imgHeight / (textLines.length + 2));
      const yPosition = Math.floor(imgHeight * 0.3) + (index * lineHeight);
      const estimatedWidth = Math.floor(imgWidth * 0.7);
      const estimatedHeight = Math.floor(lineHeight * 0.8);

      return {
        id: `text-${index}`,
        text: line.trim(),
        confidence: result.data.confidence,
        region: {
          x: Math.floor(imgWidth * 0.15),
          y: yPosition,
          width: estimatedWidth,
          height: estimatedHeight
        },
        engine: 'tesseract',
        note: 'Estimated region - adjust if needed'
      };
    });
  } catch (error) {
    console.error("[TESSERACT] Error:", error.message);
    console.error("[TESSERACT] Stack:", error.stack);
    return [];
  }
}

async function detectTextWithGoogleVision(imageBuffer) {
  // Requires Google Cloud Vision API credentials
  const vision = require('@google-cloud/vision');
  const client = new vision.ImageAnnotatorClient();

  try {
    const [result] = await client.textDetection(imageBuffer);
    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return [];
    }

    // Skip first detection (full text), return individual words
    return detections.slice(1).map((detection, index) => ({
      id: `text-${index}`,
      text: detection.description,
      region: {
        x: detection.boundingPoly.vertices[0].x,
        y: detection.boundingPoly.vertices[0].y,
        width: detection.boundingPoly.vertices[1].x - detection.boundingPoly.vertices[0].x,
        height: detection.boundingPoly.vertices[2].y - detection.boundingPoly.vertices[0].y
      },
      engine: 'google-vision'
    }));
  } catch (error) {
    console.error("[GOOGLE-VISION] Error:", error.message);
    throw error;
  }
}

async function createMaskFromRegions(imageBuffer, regions) {
  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();

  // Create white mask for regions to remove
  const canvas = createCanvas(metadata.width, metadata.height);
  const ctx = canvas.getContext('2d');

  // Fill with black (keep)
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, metadata.width, metadata.height);

  // Draw white rectangles for regions to remove
  ctx.fillStyle = 'white';
  regions.forEach(region => {
    ctx.fillRect(region.x, region.y, region.width, region.height);
  });

  return canvas.toBuffer('image/png');
}

async function removeTextWithClipDrop(imageBuffer, maskBuffer) {
  const form = new FormData();
  form.append('image_file', imageBuffer, { filename: 'image.png' });
  form.append('mask_file', maskBuffer, { filename: 'mask.png' });

  const response = await axios.post(
    'https://clipdrop-api.co/cleanup/v1',
    form,
    {
      headers: {
        'x-api-key': process.env.CLIPDROP_API_KEY,
        ...form.getHeaders()
      },
      responseType: 'arraybuffer',
      timeout: 60000
    }
  );

  return Buffer.from(response.data);
}

async function removeTextWithSimpleMethod(imageBuffer, regions) {
  // Simple approach: blur the text regions
  let image = sharp(imageBuffer);

  // For each region, extract, blur heavily, and composite back
  for (const region of regions) {
    const blurred = await sharp(imageBuffer)
      .extract({
        left: Math.max(0, region.x),
        top: Math.max(0, region.y),
        width: region.width,
        height: region.height
      })
      .blur(20)
      .toBuffer();

    image = image.composite([{
      input: blurred,
      left: region.x,
      top: region.y
    }]);
  }

  return await image.png().toBuffer();
}

async function addTextToImage(imageBuffer, replacements) {
  const image = await loadImage(imageBuffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  // Draw original image
  ctx.drawImage(image, 0, 0);

  // Add new text
  replacements.forEach(replacement => {
    const { region, new_text, style } = replacement;

    ctx.font = `${style?.fontSize || '24px'} ${style?.fontFamily || 'Arial'}`;
    ctx.fillStyle = style?.color || '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Add shadow if specified
    if (style?.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }

    ctx.fillText(new_text, region.x, region.y);
  });

  return canvas.toBuffer('image/png');
}

// ===========================================
// GET /api/image-text/test
// Test endpoint
// ===========================================
router.get("/test", (req, res) => {
  res.json({
    status: "ok",
    message: "Image Text Replacement API is running",
    features: [
      "Text detection (OCR)",
      "Text removal (inpainting)",
      "Text replacement",
      "WordPress integration"
    ],
    ocr_engines: {
      google_vision: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      tesseract: true
    },
    inpainting: {
      clipdrop: !!process.env.CLIPDROP_API_KEY,
      simple_blur: true
    }
  });
});

module.exports = router;
