/**
 * Playwright Service
 * Main orchestrator for universal website editing via browser automation
 * Coordinates browser pool, session management, and AI-powered section detection
 */

const BrowserPoolManager = require('./browserPool');
const SessionManager = require('./sessionManager');
const SectionDetector = require('./sectionDetector'); // Reuse existing AI-powered detector!

class PlaywrightService {
  constructor() {
    this.browserPool = new BrowserPoolManager();
    this.sessionManager = new SessionManager();
    this.sectionDetector = new SectionDetector(); // Already platform-agnostic!
    this.initialized = false;

    console.log('[Playwright Service] Instance created');
  }

  /**
   * Initialize the service (browser pool + session manager)
   */
  async initialize() {
    if (this.initialized) {
      console.log('[Playwright Service] Already initialized');
      return;
    }

    try {
      console.log('[Playwright Service] Initializing...');

      // Initialize browser pool
      await this.browserPool.initialize();

      // Initialize session manager
      await this.sessionManager.initialize();

      this.initialized = true;
      console.log('[Playwright Service] Initialization complete');
    } catch (error) {
      console.error('[Playwright Service] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Connect to a website (with optional authentication)
   * @param {string} siteId - Unique site identifier
   * @param {string} siteUrl - Website URL
   * @param {Object} credentials - Optional login credentials
   * @returns {Object} - { success, contextId, siteInfo }
   */
  async connect(siteId, siteUrl, credentials = null) {
    try {
      console.log('[Playwright Service] Connecting to:', siteUrl);

      // Check for existing session
      const existingSession = await this.sessionManager.loadSession(siteId);

      // Acquire browser context with optional session
      const { contextId, context } = await this.browserPool.acquireContext({
        storageState: existingSession || undefined
      });

      // Create new page
      const page = await context.newPage();

      // Set default timeout
      page.setDefaultTimeout(parseInt(process.env.BROWSER_TIMEOUT || '30000'));

      // Navigate to site
      console.log('[Playwright Service] Navigating to:', siteUrl);
      await page.goto(siteUrl, {
        waitUntil: 'networkidle',
        timeout: parseInt(process.env.BROWSER_TIMEOUT || '30000')
      });

      // If credentials provided and no existing session, perform login
      if (credentials && credentials.loginUrl && !existingSession) {
        console.log('[Playwright Service] Performing login...');
        await this.performLogin(page, credentials);

        // Save session after successful login
        const storageState = await context.storageState();
        await this.sessionManager.saveSession(siteId, storageState);
        console.log('[Playwright Service] Session saved after login');
      }

      // Get site information
      const title = await page.title();
      const url = page.url();

      console.log('[Playwright Service] Connected successfully:', { title, url });

      return {
        success: true,
        contextId,
        siteInfo: {
          url: url,
          title: title,
          connected: true
        }
      };

    } catch (error) {
      console.error('[Playwright Service] Connection error:', error);
      throw new Error(`Failed to connect: ${error.message}`);
    }
  }

  /**
   * Perform login on a website (AI-powered form detection)
   * @param {Page} page - Playwright page object
   * @param {Object} credentials - { loginUrl, username, password }
   */
  async performLogin(page, credentials) {
    try {
      // Navigate to login page
      await page.goto(credentials.loginUrl, { waitUntil: 'networkidle' });

      // Wait for login form to be visible
      await page.waitForLoadState('domcontentloaded');

      // Try multiple common selectors for username field
      const usernameSelectors = [
        'input[type="email"]',
        'input[type="text"]',
        'input[name="username"]',
        'input[name="email"]',
        'input[name="user"]',
        'input[id="username"]',
        'input[id="email"]'
      ];

      let usernameField = null;
      for (const selector of usernameSelectors) {
        usernameField = await page.$(selector);
        if (usernameField) {
          console.log('[Playwright Service] Found username field:', selector);
          break;
        }
      }

      if (!usernameField) {
        throw new Error('Could not find username/email field');
      }

      // Fill username
      await page.fill(usernameSelectors.find(s => page.$(s)), credentials.username);
      console.log('[Playwright Service] Username filled');

      // Fill password
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[name="pass"]',
        'input[id="password"]'
      ];

      let passwordField = null;
      for (const selector of passwordSelectors) {
        passwordField = await page.$(selector);
        if (passwordField) {
          console.log('[Playwright Service] Found password field:', selector);
          break;
        }
      }

      if (!passwordField) {
        throw new Error('Could not find password field');
      }

      await page.fill(passwordSelectors.find(s => page.$(s)), credentials.password);
      console.log('[Playwright Service] Password filled');

      // Submit form
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'button:has-text("Submit")'
      ];

      // Click submit and wait for navigation
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
        page.click(submitSelectors.join(', '))
      ]);

      console.log('[Playwright Service] Login submitted');

      // Check if login was successful (simple heuristic: no longer on login page)
      const currentUrl = page.url();
      if (currentUrl === credentials.loginUrl) {
        throw new Error('Login may have failed - still on login page');
      }

      console.log('[Playwright Service] Login successful');

    } catch (error) {
      console.error('[Playwright Service] Login failed:', error);
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  /**
   * Detect editable sections on a page using AI
   * @param {string} contextId - Browser context ID
   * @param {string} pageUrl - Page URL to analyze
   * @returns {Array} - Detected sections
   */
  async detectSections(contextId, pageUrl) {
    try {
      const entry = this.browserPool.activeContexts.get(contextId);
      if (!entry) {
        throw new Error('Invalid context ID');
      }

      const pages = entry.context.pages();
      const page = pages[0] || await entry.context.newPage();

      // Navigate if needed
      if (page.url() !== pageUrl) {
        console.log('[Playwright Service] Navigating to:', pageUrl);
        await page.goto(pageUrl, { waitUntil: 'networkidle' });
      }

      // Get fully-rendered HTML (after JavaScript execution)
      const htmlContent = await page.content();
      const pageTitle = await page.title();

      console.log('[Playwright Service] Detecting sections with AI...');

      // Use existing SectionDetector service (already platform-agnostic!)
      const sections = await this.sectionDetector.detectSections(htmlContent, pageTitle);

      console.log(`[Playwright Service] Detected ${sections.length} sections`);

      return sections;

    } catch (error) {
      console.error('[Playwright Service] Section detection error:', error);
      throw new Error(`Failed to detect sections: ${error.message}`);
    }
  }

  /**
   * Update content on a page
   * @param {string} contextId - Browser context ID
   * @param {string} pageUrl - Page URL
   * @param {string} sectionSelector - CSS selector for section
   * @param {string} newContent - New HTML content
   * @returns {Object} - { success, message, snapshot }
   */
  async updateContent(contextId, pageUrl, sectionSelector, newContent) {
    try {
      const entry = this.browserPool.activeContexts.get(contextId);
      if (!entry) {
        throw new Error('Invalid context ID');
      }

      const pages = entry.context.pages();
      const page = pages[0];

      // Navigate if needed
      if (page.url() !== pageUrl) {
        console.log('[Playwright Service] Navigating to:', pageUrl);
        await page.goto(pageUrl, { waitUntil: 'networkidle' });
      }

      // Create snapshot before changes
      const snapshot = await page.content();

      console.log('[Playwright Service] Updating content with selector:', sectionSelector);

      // Update content in browser
      const success = await page.evaluate(
        ({ selector, content }) => {
          const element = document.querySelector(selector);
          if (element) {
            element.innerHTML = content;
            return true;
          }
          return false;
        },
        { selector: sectionSelector, content: newContent }
      );

      if (!success) {
        throw new Error(`Section not found: ${sectionSelector}`);
      }

      console.log('[Playwright Service] Content updated successfully');

      // Note: Changes are visible in browser but not persisted
      // Persistence would require triggering site-specific save mechanisms

      return {
        success: true,
        message: 'Content updated in browser (not yet persisted)',
        snapshot: snapshot.substring(0, 500) // First 500 chars for verification
      };

    } catch (error) {
      console.error('[Playwright Service] Content update error:', error);
      throw new Error(`Failed to update content: ${error.message}`);
    }
  }

  /**
   * Take a screenshot of a page
   * @param {string} contextId - Browser context ID
   * @param {string} pageUrl - Optional page URL (if different from current)
   * @returns {Buffer} - Screenshot buffer
   */
  async takeScreenshot(contextId, pageUrl = null) {
    try {
      const entry = this.browserPool.activeContexts.get(contextId);
      if (!entry) {
        throw new Error('Invalid context ID');
      }

      const pages = entry.context.pages();
      const page = pages[0];

      // Navigate if page URL provided and different
      if (pageUrl && page.url() !== pageUrl) {
        await page.goto(pageUrl, { waitUntil: 'networkidle' });
      }

      const screenshot = await page.screenshot({
        fullPage: true,
        type: 'png'
      });

      console.log('[Playwright Service] Screenshot captured');

      return screenshot;

    } catch (error) {
      console.error('[Playwright Service] Screenshot error:', error);
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  /**
   * Disconnect from a website and release resources
   * @param {string} contextId - Browser context ID
   */
  async disconnect(contextId) {
    try {
      await this.browserPool.releaseContext(contextId);
      console.log('[Playwright Service] Disconnected:', contextId);
    } catch (error) {
      console.error('[Playwright Service] Disconnect error:', error);
      throw error;
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      browserPool: this.browserPool.getStats(),
      sessions: this.sessionManager.getStats(),
      initialized: this.initialized
    };
  }

  /**
   * Cleanup expired sessions
   */
  async cleanup() {
    console.log('[Playwright Service] Running cleanup...');
    await this.sessionManager.cleanupExpiredSessions();
    await this.browserPool.cleanupIdleContexts();
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    console.log('[Playwright Service] Shutting down...');
    await this.browserPool.shutdown();
    await this.sessionManager.shutdown();
    this.initialized = false;
    console.log('[Playwright Service] Shutdown complete');
  }
}

module.exports = PlaywrightService;
