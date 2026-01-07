/**
 * Browser Pool Manager
 * Manages a pool of headless browsers for Playwright operations
 * Optimizes performance by reusing browser instances
 */

const { chromium } = require('playwright');

class BrowserPoolManager {
  constructor() {
    this.pool = [];
    this.maxPoolSize = parseInt(process.env.BROWSER_POOL_SIZE || '3');
    this.activeContexts = new Map();
    console.log(`[Browser Pool] Initializing with max pool size: ${this.maxPoolSize}`);
  }

  /**
   * Initialize the browser pool by pre-launching browsers
   */
  async initialize() {
    console.log('[Browser Pool] Starting initialization...');

    try {
      // Pre-launch browsers for faster response times
      for (let i = 0; i < this.maxPoolSize; i++) {
        const browser = await this.createBrowser();
        this.pool.push({
          browser,
          inUse: false,
          lastUsed: Date.now(),
          id: `browser_${i}`
        });
        console.log(`[Browser Pool] Browser ${i + 1}/${this.maxPoolSize} launched`);
      }

      console.log(`[Browser Pool] Ready with ${this.maxPoolSize} browsers`);
    } catch (error) {
      console.error('[Browser Pool] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create a new browser instance with production-ready settings
   */
  async createBrowser() {
    return await chromium.launch({
      headless: process.env.BROWSER_HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check'
      ],
      timeout: parseInt(process.env.BROWSER_TIMEOUT || '30000')
    });
  }

  /**
   * Acquire a browser context for use
   * @param {Object} options - Playwright context options
   * @returns {Object} - { contextId, context }
   */
  async acquireContext(options = {}) {
    // Find an available browser in the pool
    let poolEntry = this.pool.find(entry => !entry.inUse);

    if (!poolEntry) {
      console.warn('[Browser Pool] Pool exhausted, creating temporary browser');
      const browser = await this.createBrowser();
      poolEntry = {
        browser,
        inUse: true,
        temporary: true,
        id: `temp_${Date.now()}`
      };
    } else {
      poolEntry.inUse = true;
      poolEntry.lastUsed = Date.now();
      console.log(`[Browser Pool] Acquired browser: ${poolEntry.id}`);
    }

    // Create new browser context with options
    const context = await poolEntry.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'SafeWebEdit/1.0 (Playwright; Universal Website Editor)',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      ...options
    });

    // Generate unique context ID
    const contextId = `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store context reference
    this.activeContexts.set(contextId, {
      context,
      poolEntry,
      createdAt: Date.now()
    });

    console.log(`[Browser Pool] Context created: ${contextId}`);
    return { contextId, context };
  }

  /**
   * Release a browser context back to the pool
   * @param {string} contextId - The context ID to release
   */
  async releaseContext(contextId) {
    const entry = this.activeContexts.get(contextId);

    if (!entry) {
      console.warn(`[Browser Pool] Context not found: ${contextId}`);
      return;
    }

    try {
      // Close the context
      await entry.context.close();
      console.log(`[Browser Pool] Context closed: ${contextId}`);

      // If temporary browser, close it completely
      if (entry.poolEntry.temporary) {
        await entry.poolEntry.browser.close();
        console.log(`[Browser Pool] Temporary browser closed: ${entry.poolEntry.id}`);
      } else {
        // Mark pool browser as available
        entry.poolEntry.inUse = false;
        console.log(`[Browser Pool] Browser released: ${entry.poolEntry.id}`);
      }

      this.activeContexts.delete(contextId);
    } catch (error) {
      console.error(`[Browser Pool] Error releasing context ${contextId}:`, error);
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const available = this.pool.filter(e => !e.inUse).length;
    const inUse = this.pool.filter(e => e.inUse).length;
    const activeContextCount = this.activeContexts.size;

    return {
      poolSize: this.pool.length,
      available,
      inUse,
      activeContexts: activeContextCount,
      maxPoolSize: this.maxPoolSize
    };
  }

  /**
   * Shutdown all browsers and cleanup
   */
  async shutdown() {
    console.log('[Browser Pool] Shutting down...');

    // Close all active contexts
    for (const [contextId, entry] of this.activeContexts) {
      try {
        await entry.context.close();
      } catch (error) {
        console.error(`[Browser Pool] Error closing context ${contextId}:`, error);
      }
    }

    // Close all browsers in pool
    for (const entry of this.pool) {
      try {
        await entry.browser.close();
      } catch (error) {
        console.error(`[Browser Pool] Error closing browser ${entry.id}:`, error);
      }
    }

    this.pool = [];
    this.activeContexts.clear();
    console.log('[Browser Pool] Shutdown complete');
  }

  /**
   * Cleanup idle contexts (auto-cleanup after timeout)
   */
  async cleanupIdleContexts(maxIdleMs = 600000) { // 10 minutes default
    const now = Date.now();
    const toCleanup = [];

    for (const [contextId, entry] of this.activeContexts) {
      const idleTime = now - entry.createdAt;
      if (idleTime > maxIdleMs) {
        toCleanup.push(contextId);
      }
    }

    for (const contextId of toCleanup) {
      console.log(`[Browser Pool] Cleaning up idle context: ${contextId}`);
      await this.releaseContext(contextId);
    }

    return toCleanup.length;
  }
}

module.exports = BrowserPoolManager;
