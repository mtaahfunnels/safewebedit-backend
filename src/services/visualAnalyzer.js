/**
 * Visual Page Analyzer Service
 * Uses Playwright to render WordPress pages and detect sections visually
 */

const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

class VisualAnalyzer {
  constructor() {
    this.browser = null;
    this.screenshotsDir = '/root/safewebedit/backend/screenshots';
  }

  /**
   * Initialize browser instance
   */
  async init() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }

    // Ensure screenshots directory exists
    try {
      await fs.mkdir(this.screenshotsDir, { recursive: true });
    } catch (e) {
      // Directory exists
    }
  }

  /**
   * Analyze WordPress page visually
   * @param {string} pageUrl - Full URL of the WordPress page
   * @param {string} pageId - WordPress page ID for filename
   * @returns {Promise<Object>} Analysis result with screenshot and sections
   */
  async analyzePage(pageUrl, pageId) {
    await this.init();

    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'SafeWebEdit Visual Analyzer/1.0'
    });

    const page = await context.newPage();

    try {
      console.log('[Visual Analyzer] Loading page:', pageUrl);

      // Navigate to page with timeout
      await page.goto(pageUrl, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait for content to render
      await page.waitForTimeout(2000);

      // Remove overlays and popups that might interfere
      await page.evaluate(() => {
        // Remove cookie banners, popups, etc.
        const overlays = document.querySelectorAll('[class*="popup"], [class*="modal"], [class*="cookie"], [id*="popup"]');
        overlays.forEach(el => el.remove());
      });

      // Take full-page screenshot
      const screenshotFilename = `page-${pageId}-${Date.now()}.png`;
      const screenshotPath = path.join(this.screenshotsDir, screenshotFilename);

      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      });

      console.log('[Visual Analyzer] Screenshot saved:', screenshotPath);

      // Detect sections by analyzing DOM structure and visual position
      const sections = await page.evaluate(() => {
        const results = [];

        // Helper functions
        const getVisualPosition = (yPos) => {
          const documentHeight = document.documentElement.scrollHeight;
          const ratio = yPos / documentHeight;
          if (ratio < 0.25) return 'top';
          if (ratio < 0.75) return 'middle';
          return 'bottom';
        };

        const getUniqueSelector = (element) => {
          // Try ID first
          if (element.id) return `#${element.id}`;

          // Build a path up the DOM tree
          const path = [];
          let current = element;
          let foundUnique = false;

          while (current && current !== document.body && path.length < 5) {
            let selector = current.tagName.toLowerCase();
            
            // Add ID if available
            if (current.id) {
              selector = `#${current.id}`;
              path.unshift(selector);
              foundUnique = true;
              break;
            }
            
            // Add classes if available
            if (current.className && typeof current.className === 'string') {
              const classes = current.className.split(' ').filter(c => 
                c.length > 0 && 
                !c.match(/^(wp-|elementor-|et-|vc-|fl-)/) // Skip builder classes
              );
              if (classes.length > 0) {
                selector += `.${classes[0]}`;
              }
            }
            
            // Add nth-child for specificity
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(
                s => s.tagName === current.tagName
              );
              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-of-type(${index})`;
              }
            }
            
            path.unshift(selector);
            
            // Test if current path is unique
            const testSelector = path.join(' > ');
            if (document.querySelectorAll(testSelector).length === 1) {
              foundUnique = true;
              break;
            }
            
            current = current.parentElement;
          }

          return path.join(' > ') || 'body';
        };

        const getTextPreview = (element) => {
          const text = element.innerText || element.textContent || '';
          return text.trim().substring(0, 150);
        };

        const getSectionType = (heading, text) => {
          const combined = (heading + ' ' + text).toLowerCase();
          if (combined.match(/hero|banner|welcome|get started|jumbotron/)) return 'hero';
          if (combined.match(/about|who we are|our story|our mission/)) return 'about';
          if (combined.match(/service|what we do|our services|what we offer/)) return 'services';
          if (combined.match(/feature|benefit|why choose|why us/)) return 'features';
          if (combined.match(/testimonial|review|what.*say|client/)) return 'testimonials';
          if (combined.match(/contact|get in touch|reach us|talk to us/)) return 'contact';
          if (combined.match(/pricing|plan|package|cost/)) return 'pricing';
          if (combined.match(/team|our team|meet.*team|staff/)) return 'team';
          if (combined.match(/portfolio|work|project|case stud/)) return 'portfolio';
          if (combined.match(/cta|call.*action|sign up|subscribe/)) return 'cta';
          return 'content';
        };

        // SMART VISUAL LAYOUT ANALYSIS
        // Step 1: Find all major headings (section markers)
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
        const sectionMarkers = [];

        headings.forEach(heading => {
          const rect = heading.getBoundingClientRect();
          if (rect.height > 0 && rect.width > 0) {
            // Skip if in nav/footer/aside
            let parent = heading.parentElement;
            let skip = false;
            while (parent && parent !== document.body) {
              const tag = parent.tagName.toLowerCase();
              const role = parent.getAttribute('role') || '';
              if (tag === 'nav' || tag === 'footer' || tag === 'aside' || role === 'navigation') {
                skip = true;
                break;
              }
              parent = parent.parentElement;
            }

            if (!skip) {
              sectionMarkers.push({
                element: heading,
                y: rect.top + window.scrollY,
                text: heading.innerText || heading.textContent || '',
                type: 'heading'
              });
            }
          }
        });

        // Step 2: Find visual gaps (large vertical spacing = section break)
        const mainContent = document.querySelector('main, [role="main"], article, .content, #content, body');
        if (mainContent) {
          const children = Array.from(mainContent.children);
          let lastBottom = 0;

          children.forEach((child, idx) => {
            const rect = child.getBoundingClientRect();
            if (rect.height === 0) return;

            const top = rect.top + window.scrollY;
            const gap = top - lastBottom;

            // Large gap (60px+) = section boundary
            if (gap > 60 && lastBottom > 0) {
              sectionMarkers.push({
                element: child,
                y: top,
                text: '',
                type: 'gap'
              });
            }

            lastBottom = rect.bottom + window.scrollY;
          });
        }

        // Step 3: Sort markers by position and create sections
        sectionMarkers.sort((a, b) => a.y - b.y);

        // Always start with first section from top of page
        if (sectionMarkers.length === 0 || sectionMarkers[0].y > 100) {
          sectionMarkers.unshift({
            element: document.body.firstElementChild,
            y: 0,
            text: 'Top',
            type: 'start'
          });
        }

        // Create sections between markers
        sectionMarkers.forEach((marker, idx) => {
          const startY = marker.y;
          const endY = idx < sectionMarkers.length - 1
            ? sectionMarkers[idx + 1].y
            : document.documentElement.scrollHeight;

          // Find all visible elements in this range
          const elementsInRange = [];
          const allElements = document.querySelectorAll('*');

          allElements.forEach(el => {
            const rect = el.getBoundingClientRect();
            const elY = rect.top + window.scrollY;

            // Element is in this section if its top is between startY and endY
            if (elY >= startY && elY < endY && rect.height >= 50 && rect.width >= 200) {
              const tag = el.tagName.toLowerCase();
              const role = el.getAttribute('role') || '';
              // Skip nav, footer, script, style, etc
              if (tag !== 'nav' && tag !== 'footer' && tag !== 'aside' && tag !== 'script' && tag !== 'style' && role !== 'navigation') {
                elementsInRange.push(el);
              }
            }
          });

          if (elementsInRange.length === 0) return;

          // Find the container element that wraps this section
          let sectionContainer = marker.element;

          // Try to find a better container
          const potentialContainers = elementsInRange.filter(el => {
            const rect = el.getBoundingClientRect();
            // Large enough to be a section container
            return rect.height >= 150 && rect.width >= document.documentElement.clientWidth * 0.7;
          });

          if (potentialContainers.length > 0) {
            // Use the smallest container that still wraps content
            potentialContainers.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
            sectionContainer = potentialContainers[0];
          }

          const rect = sectionContainer.getBoundingClientRect();
          const text = getTextPreview(sectionContainer);

          if (text.length < 20) return; // Skip sections with minimal text

          const cssSelector = getUniqueSelector(sectionContainer);
          const sectionType = getSectionType(marker.text, text);
          const position = getVisualPosition(startY);

          const sectionName = sectionType === 'content'
            ? `${position}-section-${results.length + 1}`
            : `${sectionType}-section`;

          const label = marker.text && marker.type === 'heading'
            ? marker.text
            : (sectionType === 'content'
              ? `${position.charAt(0).toUpperCase() + position.slice(1)} Section ${results.length + 1}`
              : `${sectionType.charAt(0).toUpperCase() + sectionType.slice(1)} Section`);

          results.push({
            section_name: sectionName,
            label: label,
            description: `${sectionType === 'content' ? 'Content' : sectionType.charAt(0).toUpperCase() + sectionType.slice(1)} section at ${position} of page`,
            css_selector: cssSelector,
            content_preview: text,
            section_type: sectionType,
            position: results.length + 1,
            estimated_position: position,
            bounding_box: {
              x: Math.round(rect.x),
              y: Math.round(rect.y + window.scrollY),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          });
        });

        // If we still have less than 2 sections, fall back to simple split
        if (results.length < 2) {
          const viewportHeight = window.innerHeight;
          const documentHeight = document.documentElement.scrollHeight;
          const numSections = Math.min(5, Math.ceil(documentHeight / viewportHeight));

          for (let i = 0; i < numSections; i++) {
            const startY = (documentHeight / numSections) * i;
            const endY = (documentHeight / numSections) * (i + 1);
            const midY = (startY + endY) / 2;

            // Find element at this Y position
            const element = document.elementFromPoint(
              document.documentElement.clientWidth / 2,
              midY - window.scrollY
            );

            if (element && element !== document.documentElement && element !== document.body) {
              const rect = element.getBoundingClientRect();
              const text = getTextPreview(element);

              if (text.length >= 20) {
                const position = getVisualPosition(midY);
                results.push({
                  section_name: `${position}-section-${i + 1}`,
                  label: `${position.charAt(0).toUpperCase() + position.slice(1)} Section ${i + 1}`,
                  description: `Content section at ${position} of page`,
                  css_selector: getUniqueSelector(element),
                  content_preview: text,
                  section_type: 'content',
                  position: i + 1,
                  estimated_position: position,
                  bounding_box: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y + window.scrollY),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                  }
                });
              }
            }
          }
        }

        return results;
      });

      console.log(`[Visual Analyzer] Detected ${sections.length} sections`);

      await context.close();

      return {
        success: true,
        screenshot: {
          filename: screenshotFilename,
          path: screenshotPath,
          url: `/screenshots/${screenshotFilename}`
        },
        sections: sections,
        metadata: {
          page_url: pageUrl,
          analyzed_at: new Date().toISOString(),
          viewport: '1920x1080'
        }
      };

    } catch (error) {
      console.error('[Visual Analyzer] Error:', error);
      await context.close();

      return {
        success: false,
        error: {
          type: error.name || 'analysis_error',
          message: error.message || 'Failed to analyze page visually',
        },
        sections: []
      };
    }
  }

  /**
   * Close browser instance
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = VisualAnalyzer;
