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
    html = html.replace('</body>', clickDetectionScript + '</body>');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://safewebedit.com");

    res.send(html);

  } catch (error) {
    console.error('[VISUAL-PROXY] Error:', error.message);
    res.status(500).send(`<html><body><h1>Failed to load page</h1><p>${error.message}</p></body></html>`);
  }
});

module.exports = router;
