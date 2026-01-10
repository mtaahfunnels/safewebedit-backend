const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }

    console.log('[VISUAL-PROXY] Fetching:', url);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'SafeWebEdit/1.0'
      },
      timeout: 10000,
      maxRedirects: 5
    });

    let html = response.data;

    // Inject enhanced click detection script
// Add link rewriting script BEFORE clickDetectionScript

// Line 26 - Insert new linkRewriteScript constant before clickDetectionScript
const linkRewriteScript = `
  <script>
    (function() {
      console.log('[Visual Proxy] Link rewriter loaded');
      
      // Get base site URL from proxy URL
      const proxyUrl = window.location.href;
      const urlMatch = proxyUrl.match(/url=([^&]+)/);
      if (!urlMatch) {
        console.log('[Visual Proxy] No URL param found, link rewriting disabled');
        return;
      }
      
      const baseSiteUrl = decodeURIComponent(urlMatch[1]);
      const siteOrigin = new URL(baseSiteUrl).origin;
      
      console.log('[Visual Proxy] Base site:', siteOrigin);
      
      // Intercept ALL clicks in capture phase (before edit zone detection)
      document.addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (!link) return; // Not a link, let edit zone detection handle it
        
        const href = link.getAttribute('href');
        if (!href) return;
        
        // Skip anchors, javascript, mailto, tel
        if (href.startsWith('#') || 
            href.startsWith('javascript:') || 
            href.startsWith('mailto:') ||
            href.startsWith('tel:')) {
          return;
        }
        
        // Check if external link
        try {
          if (href.startsWith('http')) {
            const linkUrl = new URL(href);
            if (linkUrl.origin !== siteOrigin) {
              console.log('[Visual Proxy] External link, allowing:', href);
              return;
            }
          }
        } catch (err) {}
        
        // This is an internal link - intercept it
        e.preventDefault();
        e.stopPropagation();
        
        // Build target URL
        let targetUrl;
        if (href.startsWith('http')) {
          targetUrl = href;
        } else if (href.startsWith('/')) {
          targetUrl = siteOrigin + href;
        } else {
          // Relative URL
          const currentPath = new URL(baseSiteUrl).pathname;
          const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
          targetUrl = siteOrigin + currentDir + href;
        }
        
        // Navigate through proxy
        const newProxyUrl = '/api/visual-proxy?url=' + encodeURIComponent(targetUrl);
        console.log('[Visual Proxy] Navigating:', targetUrl);
        window.location.href = newProxyUrl;
        
      }, true); // Use capture phase!
      
      console.log('[Visual Proxy] Link interceptor active');
    })();
  </script>
`;

    const popupBlockerScript = `  <script>
    (function() {
      console.log('[POPUP-BLOCKER] Initializing...');

      const POPUP_SELECTORS = [
        '[class*="modal"]:not([class*="cookie"])',
        '[class*="popup"]:not([class*="cookie"])',
        '[class*="overlay"]:not([class*="cookie"])',
        '[id*="modal"]:not([id*="cookie"])',
        '[id*="popup"]:not([id*="cookie"])',
        '[id*="overlay"]:not([id*="cookie"])',
        '.elementor-popup-modal',
        '.om-popup',
        '.pum-overlay',
        '.ck_modal',
        '.mfp-wrap',
        '.fancybox-overlay',
        '[role="dialog"]',
        '[aria-modal="true"]',
        'div[style*="z-index: 9999"]',
        'div[style*="position: fixed"]',
        'div[style*="position: absolute"][style*="z-index"]'
      ];

      function injectBlockingCSS() {
        const style = document.createElement('style');
        style.id = 'safewebedit-popup-blocker';
        let css = POPUP_SELECTORS.join(', ') + ' { display: none !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; z-index: -9999 !important; } ';
        css += 'body, html { overflow: auto !important; overflow-x: auto !important; overflow-y: auto !important; position: static !important; } ';
        css += '.modal-backdrop, .popup-backdrop, .overlay-backdrop, [class*="-backdrop"] { display: none !important; }';
        style.textContent = css;
        document.head.appendChild(style);
      }

      function closePopups() {
        POPUP_SELECTORS.forEach(selector => {
          document.querySelectorAll(selector).forEach(popup => popup.remove());
        });
        document.body.style.overflow = 'auto';
        document.body.classList.remove('modal-open', 'popup-open', 'no-scroll');
      }

      function watchForPopups() {
        const observer = new MutationObserver(mutations => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === 1) {
                const className = node.className || '';
                if (typeof className === 'string' && (className.includes('modal') || className.includes('popup'))) {
                  setTimeout(closePopups, 100);
                }
              }
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }

      injectBlockingCSS();
      closePopups();
      watchForPopups();
      
      // Run aggressively on page load
      setTimeout(closePopups, 100);
      setTimeout(closePopups, 500);
      setTimeout(closePopups, 1000);
      setTimeout(closePopups, 2000);
      setTimeout(closePopups, 3000);
      
      // Continue checking every 500ms
      setInterval(closePopups, 500);

      console.log('[POPUP-BLOCKER] Active - aggressive mode');
    })();
  </script>
`;

    const clickDetectionScript = `
      <script>
        (function() {
          console.log('[SafeWebEdit] Enhanced click detection loaded');

          // Function to generate unique CSS selector for an element
          function getCssSelector(element) {
            if (!element || element.nodeType !== 1) return '';

            // Try ID first
            if (element.id) {
              return '#' + element.id;
            }

            // Build path using classes and nth-child
            const path = [];
            let current = element;

            while (current && current.nodeType === Node.ELEMENT_NODE) {
              let selector = current.tagName.toLowerCase();

              // Add classes if available
              if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\\s+/)
                  .filter(c => c && !c.match(/^(active|hover|focus|selected)$/));
                if (classes.length > 0) {
                  selector += '.' + classes.slice(0, 2).join('.');
                }
              }

              // Add nth-child if there are siblings with same tag
              if (current.parentNode) {
                const siblings = Array.from(current.parentNode.children);
                const sameTagSiblings = siblings.filter(s => s.tagName === current.tagName);
                if (sameTagSiblings.length > 1) {
                  const index = sameTagSiblings.indexOf(current) + 1;
                  selector += ':nth-child(' + index + ')';
                }
              }

              path.unshift(selector);

              // Stop at body or after 5 levels
              if (current.tagName.toLowerCase() === 'body' || path.length >= 5) {
                break;
              }

              current = current.parentNode;
            }

            return path.join(' > ');
          }

          // Function to check if element contains editable text
          function isEditableTextElement(element) {
            const editableTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'DIV', 'A', 'BUTTON', 'LI', 'TD', 'TH', 'LABEL'];

            if (!editableTags.includes(element.tagName)) {
              return false;
            }

            // Check if element has direct text content (not just whitespace)
            const directText = Array.from(element.childNodes)
              .filter(node => node.nodeType === Node.TEXT_NODE)
              .map(node => node.textContent.trim())
              .join(' ');

            return directText.length > 0;
          }

          // Get the innermost text element
          function getTextElement(target) {
            let current = target;

            // If clicked element is editable, return it
            if (isEditableTextElement(current)) {
              return current;
            }

            // Try to find editable text in children
            const textChild = Array.from(current.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, button'))
              .find(el => isEditableTextElement(el));

            if (textChild) {
              return textChild;
            }

            // Try parents
            while (current && current.tagName !== 'BODY') {
              if (isEditableTextElement(current)) {
                return current;
              }
              current = current.parentNode;
            }

            return null;
          }

          // Setup click detection
          function setupClickDetection() {
            let hoveredElement = null;

            // Add styles for hover effect
            const style = document.createElement('style');
            style.textContent = \`
              .safewebedit-editable-hover {
                outline: 2px dashed #007bff !important;
                background-color: rgba(0, 123, 255, 0.05) !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
              }
              .safewebedit-editable-hover::after {
                content: "✏️ Click to edit";
                position: absolute;
                top: -25px;
                left: 0;
                background: #007bff;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                white-space: nowrap;
                z-index: 10000;
                pointer-events: none;
              }
            \`;
            document.head.appendChild(style);

            // Mouse move handler to detect hoverable elements
            document.addEventListener('mousemove', function(e) {
              const target = document.elementFromPoint(e.clientX, e.clientY);

              if (!target) return;

              const textElement = getTextElement(target);

              // Remove previous hover
              if (hoveredElement && hoveredElement !== textElement) {
                hoveredElement.classList.remove('safewebedit-editable-hover');
                hoveredElement.style.position = '';
              }

              // Add new hover
              if (textElement && textElement !== hoveredElement) {
                hoveredElement = textElement;
                const originalPosition = window.getComputedStyle(textElement).position;
                if (originalPosition === 'static') {
                  textElement.style.position = 'relative';
                }
                textElement.classList.add('safewebedit-editable-hover');
              }
            }, true);

            // Click handler
            document.addEventListener('click', function(e) {
              const target = e.target;

              // Check if clicking on an image first
              if (target.tagName === 'IMG') {
                e.preventDefault();
                e.stopPropagation();

                const cssSelector = getCssSelector(target);
                const imgSrc = target.src;
                const imgWidth = target.naturalWidth || target.width;
                const imgHeight = target.naturalHeight || target.height;
                const imgAlt = target.alt || '';

                console.log('[SafeWebEdit] Image clicked:', {
                  src: imgSrc,
                  width: imgWidth,
                  height: imgHeight,
                  selector: cssSelector
                });

                // Send IMAGE_CLICKED message to parent window
                window.parent.postMessage({
                  type: 'IMAGE_CLICKED',
                  data: {
                    cssSelector: cssSelector,
                    src: imgSrc,
                    width: imgWidth,
                    height: imgHeight,
                    alt: imgAlt
                  }
                }, '*');

                return;
              }


              const textElement = getTextElement(target);

              if (!textElement) {
                console.log('[SafeWebEdit] No editable text element found');
                return;
              }

              e.preventDefault();
              e.stopPropagation();

              // Get CSS selector
              const cssSelector = getCssSelector(textElement);

              // Get text content
              const textContent = textElement.innerText || textElement.textContent;

              console.log('[SafeWebEdit] Clicked element:', {
                tag: textElement.tagName,
                text: textContent.substring(0, 50),
                selector: cssSelector
              });

              // Send to parent window
              window.parent.postMessage({
                type: 'ELEMENT_CLICKED',
                data: {
                  cssSelector: cssSelector,
                  tagName: textElement.tagName,
                  textContent: textContent.trim(),
                  innerHTML: textElement.innerHTML,
                  elementText: textContent.substring(0, 100)
                }
              }, '*');
            }, true);

            console.log('[SafeWebEdit] Click detection active - hover over text to see editable elements');
          }

          // Run when page loads
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupClickDetection);
          } else {
            setupClickDetection();
          }
        })();
      </script>
    `;

    // Inject before closing body tag
    html = html.replace('</body>', linkRewriteScript + popupBlockerScript + clickDetectionScript + '</body>');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Allow iframe embedding - DO NOT set X-Frame-Options
    res.setHeader('Content-Security-Policy', "frame-ancestors *; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(html);

  } catch (error) {
    console.error('[VISUAL-PROXY] Error:', error.message);
    res.status(500).send(`<html><body><h1>Failed to load page</h1><p>${error.message}</p></body></html>`);
  }
});

module.exports = router;
