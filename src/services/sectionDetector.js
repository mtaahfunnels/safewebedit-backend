/**
 * AI Section Detector Service
 * Analyzes WordPress page HTML and detects editable content sections
 * Uses Groq AI to intelligently identify sections without requiring manual markers
 */

const Groq = require('groq-sdk');
const cheerio = require('cheerio');

class SectionDetector {
  constructor() {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
    this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  }

  /**
   * Analyze WordPress page and detect content sections
   * @param {string} htmlContent - Full HTML content from WordPress
   * @param {string} pageTitle - Page title for context
   * @returns {Promise<Object>} Detected sections with selectors
   */
  async detectSections(htmlContent, pageTitle = 'Unknown Page') {
    try {
      console.log('[Section Detector] Starting analysis for:', pageTitle);

      // Parse HTML and extract meaningful structure
      const $ = cheerio.load(htmlContent);

      // Remove unwanted elements for cleaner analysis
      $('script, style, noscript, iframe').remove();

      // Get simplified HTML structure
      const bodyHTML = $('body').html() || htmlContent;

      // Truncate if too long (AI token limits)
      const maxLength = 15000;
      const truncatedHTML = bodyHTML.length > maxLength
        ? bodyHTML.substring(0, maxLength) + '\n... [truncated]'
        : bodyHTML;

      // Build analysis prompt
      const systemPrompt = this._buildSystemPrompt();
      const userPrompt = this._buildUserPrompt(truncatedHTML, pageTitle);

      let validatedSections;

      // Try AI detection first, fall back to pattern matching if it fails
      try {
        console.log('[Section Detector] Calling Groq AI for analysis...');

        const completion = await this.groq.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3, // Lower temperature for more consistent output
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        });

        const responseContent = completion.choices[0]?.message?.content || '{}';
        console.log('[Section Detector] AI response received');

        const detectedSections = JSON.parse(responseContent);

        // Validate and enhance detected sections with actual selectors
        validatedSections = this._validateAndEnhanceSections(detectedSections, $);
      } catch (aiError) {
        console.log('[Section Detector] AI detection failed, using fallback pattern matching');
        console.log('[Section Detector] Error:', aiError.message);
        // Fall back to pattern-based detection
        validatedSections = this._fallbackDetection($);
      }

      console.log(`[Section Detector] Found ${validatedSections.sections?.length || 0} sections`);

      return {
        success: true,
        sections: validatedSections.sections || [],
        metadata: {
          page_title: pageTitle,
          total_sections: validatedSections.sections?.length || 0,
          model: this.model,
        },
      };

    } catch (error) {
      console.error('[Section Detector] Error:', error);
      return {
        success: false,
        error: {
          type: error.name || 'detection_error',
          message: error.message || 'Failed to detect sections',
        },
        sections: [],
      };
    }
  }

  /**
   * Build system prompt for AI section detection
   * @private
   */
  _buildSystemPrompt() {
    return `You are an expert web developer analyzing HTML to identify distinct content sections that a business owner would want to update.

Your task is to analyze WordPress page HTML and identify editable content sections (like Hero, About Us, Services, Testimonials, CTA, etc.).

For each section you identify, provide:
1. section_name: Short identifier (lowercase-with-hyphens, e.g., "hero-section", "about-us")
2. label: Human-readable name (e.g., "Hero Section", "About Us")
3. description: Brief description of what content is in this section
4. selector_hint: CSS selector hint to locate this section (class, id, or semantic tag)
5. content_preview: First 100 characters of the actual text content (no HTML tags)
6. section_type: Type of section (hero, about, services, testimonials, features, cta, text_block, image_text, etc.)

Rules:
- Identify 3-8 major sections (not every paragraph)
- Focus on sections a business owner would update (hero, about, services, contact)
- Ignore navigation, footer, sidebar, header (unless they contain important editable content)
- Prefer sections with semantic meaning
- Return valid JSON only

Response format:
{
  "sections": [
    {
      "section_name": "hero-section",
      "label": "Hero Section",
      "description": "Main headline and call-to-action at top of page",
      "selector_hint": ".hero, .banner, header.main",
      "content_preview": "Welcome to our business...",
      "section_type": "hero"
    }
  ]
}`;
  }

  /**
   * Build user prompt with HTML content
   * @private
   */
  _buildUserPrompt(htmlContent, pageTitle) {
    return `Analyze this WordPress page HTML and identify distinct content sections.

Page Title: ${pageTitle}

HTML Content:
${htmlContent}

Return a JSON object with detected sections.`;
  }

  /**
   * Validate AI-detected sections and find actual CSS selectors
   * @private
   */
  _validateAndEnhanceSections(detectedSections, $) {
    if (!detectedSections.sections || !Array.isArray(detectedSections.sections)) {
      console.log('[Section Detector] No sections in AI response, using fallback detection');
      return this._fallbackDetection($);
    }

    const enhancedSections = detectedSections.sections.map((section, index) => {
      // Try to find actual CSS selector from hints
      const selector = this._findBestSelector($, section.selector_hint, section.content_preview);

      return {
        ...section,
        css_selector: selector,
        position: index + 1,
        // Add visual position hint for UI
        estimated_position: this._estimatePosition($, selector),
      };
    });

    return {
      sections: enhancedSections.filter(s => s.css_selector !== null),
    };
  }

  /**
   * Find best matching CSS selector from hints and content
   * @private
   */
  _findBestSelector($, selectorHint, contentPreview) {
    // Try selector hints first
    const hints = selectorHint ? selectorHint.split(',').map(s => s.trim()) : [];

    for (const hint of hints) {
      try {
        const elements = $(hint);
        if (elements.length > 0) {
          // If we have content preview, verify it matches
          if (contentPreview) {
            const elementText = elements.first().text().trim();
            if (elementText.includes(contentPreview.substring(0, 50))) {
              return hint;
            }
          } else {
            return hint;
          }
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }

    // Fallback: try to find by content preview
    if (contentPreview) {
      const contentStart = contentPreview.substring(0, 30).trim();
      let matchingSelector = null;

      $('section, div, article, main').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text.includes(contentStart)) {
          // Get most specific selector
          const id = $(elem).attr('id');
          const classes = $(elem).attr('class');

          if (id) {
            matchingSelector = `#${id}`;
            return false; // break
          } else if (classes) {
            const firstClass = classes.split(' ')[0];
            matchingSelector = `.${firstClass}`;
            return false;
          }
        }
      });

      if (matchingSelector) return matchingSelector;
    }

    return null; // Couldn't find selector
  }

  /**
   * Estimate visual position on page (top, middle, bottom)
   * @private
   */
  _estimatePosition($, selector) {
    if (!selector) return 'unknown';

    try {
      const element = $(selector).first();
      const allElements = $('body').find('*');
      const elementIndex = allElements.index(element);
      const totalElements = allElements.length;

      const position = elementIndex / totalElements;

      if (position < 0.3) return 'top';
      if (position < 0.7) return 'middle';
      return 'bottom';
    } catch (e) {
      return 'unknown';
    }
  }

  /**
   * Fallback detection if AI fails
   * @private
   */
  _fallbackDetection($) {
    console.log('[Section Detector] Using fallback detection method');

    const sections = [];

    // Detect common patterns
    const commonSelectors = [
      { selector: '.hero, .banner, .jumbotron, header.hero', name: 'hero-section', label: 'Hero Section', type: 'hero' },
      { selector: '#about, .about, section.about', name: 'about-section', label: 'About Us', type: 'about' },
      { selector: '#services, .services, section.services', name: 'services-section', label: 'Services', type: 'services' },
      { selector: '#features, .features, section.features', name: 'features-section', label: 'Features', type: 'features' },
      { selector: '#testimonials, .testimonials, section.testimonials', name: 'testimonials-section', label: 'Testimonials', type: 'testimonials' },
      { selector: '#contact, .contact, section.contact', name: 'contact-section', label: 'Contact', type: 'cta' },
    ];

    commonSelectors.forEach((pattern, index) => {
      const element = $(pattern.selector).first();
      if (element.length > 0) {
        const text = element.text().trim();
        sections.push({
          section_name: pattern.name,
          label: pattern.label,
          description: `Detected ${pattern.label.toLowerCase()} section`,
          selector_hint: pattern.selector,
          css_selector: pattern.selector.split(',')[0].trim(),
          content_preview: text.substring(0, 100),
          section_type: pattern.type,
          position: index + 1,
          estimated_position: this._estimatePosition($, pattern.selector.split(',')[0].trim()),
        });
      }
    });

    return { sections };
  }
}

module.exports = SectionDetector;
