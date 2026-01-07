/**
 * Site Manager
 * Abstraction layer for unified site operations across WordPress and Universal platforms
 * Provides a single interface for working with any website regardless of technology
 */

const db = require('./database');
const PlaywrightService = require('./playwrightService');

// Singleton instance of PlaywrightService
let playwrightServiceInstance = null;

class SiteManager {
  constructor() {
    console.log('[Site Manager] Instance created');
  }

  /**
   * Get or create the shared Playwright service instance
   */
  async getPlaywrightService() {
    if (!playwrightServiceInstance) {
      playwrightServiceInstance = new PlaywrightService();
      await playwrightServiceInstance.initialize();
    }
    return playwrightServiceInstance;
  }

  /**
   * Get site details regardless of platform type
   * @param {string} siteId - UUID of the site
   * @returns {Object|null} - { platform, site }
   */
  async getSite(siteId) {
    try {
      // Try WordPress first
      let site = await db.wordpressSites.findById(siteId);
      if (site) {
        return {
          platform: 'wordpress',
          site: { ...site, platform_type: 'wordpress' }
        };
      }

      // Try Universal
      site = await db.universalSites.findById(siteId);
      if (site) {
        return {
          platform: 'universal',
          site: { ...site, platform_type: 'universal' }
        };
      }

      return null;
    } catch (error) {
      console.error('[Site Manager] Error getting site:', error);
      throw error;
    }
  }

  /**
   * Get all sites for an organization (both WordPress and Universal)
   * @param {string} organizationId - UUID of the organization
   * @returns {Array} - Array of sites with platform_type property
   */
  async getAllSites(organizationId) {
    try {
      const wpSites = await db.wordpressSites.findByOrganization(organizationId);
      const universalSites = await db.universalSites.findByOrganization(organizationId);

      const allSites = [
        ...wpSites.map(s => ({ ...s, platform_type: 'wordpress' })),
        ...universalSites.map(s => ({ ...s, platform_type: 'universal' }))
      ];

      console.log(`[Site Manager] Found ${allSites.length} sites (${wpSites.length} WordPress, ${universalSites.length} Universal)`);

      return allSites;
    } catch (error) {
      console.error('[Site Manager] Error getting all sites:', error);
      throw error;
    }
  }

  /**
   * Connect a new site (auto-detects platform based on connection data)
   * @param {string} organizationId - UUID of the organization
   * @param {Object} connectionData - Connection details
   * @returns {Object} - { platform, site, connectionInfo }
   */
  async connectSite(organizationId, connectionData) {
    try {
      if (connectionData.platform_type === 'wordpress') {
        return await this.connectWordPressSite(organizationId, connectionData);
      } else {
        return await this.connectUniversalSite(organizationId, connectionData);
      }
    } catch (error) {
      console.error('[Site Manager] Error connecting site:', error);
      throw error;
    }
  }

  /**
   * Connect a WordPress site (existing functionality)
   * @param {string} organizationId - UUID of the organization
   * @param {Object} data - { site_url, site_name, wp_username, wp_app_password }
   * @returns {Object} - { platform, site }
   */
  async connectWordPressSite(organizationId, data) {
    try {
      console.log('[Site Manager] Connecting WordPress site:', data.site_url);

      const WordPressClient = require('./wordpress');

      // Verify WordPress connection
      const client = new WordPressClient(
        data.site_url,
        data.wp_username,
        data.wp_app_password
      );

      const verification = await client.verifyConnection();

      if (!verification.success) {
        throw new Error('WordPress connection failed: ' + (verification.error || 'Unknown error'));
      }

      console.log('[Site Manager] WordPress connection verified');

      // Encrypt the app password (simple base64 for now, should use proper encryption)
      const wp_app_password_encrypted = Buffer.from(data.wp_app_password).toString('base64');

      // Store in wordpress_sites table
      const site = await db.wordpressSites.create({
        organization_id: organizationId,
        site_url: data.site_url,
        site_name: data.site_name || data.site_url,
        wp_username: data.wp_username,
        wp_app_password_encrypted
      });

      console.log('[Site Manager] WordPress site created:', site.id);

      return {
        platform: 'wordpress',
        site: { ...site, platform_type: 'wordpress' }
      };

    } catch (error) {
      console.error('[Site Manager] WordPress connection error:', error);
      throw error;
    }
  }

  /**
   * Connect a universal site using Playwright
   * @param {string} organizationId - UUID of the organization
   * @param {Object} data - { site_url, site_name, credentials }
   * @returns {Object} - { platform, site, connectionInfo }
   */
  async connectUniversalSite(organizationId, data) {
    try {
      console.log('[Site Manager] Connecting universal site:', data.site_url);

      const playwrightService = await this.getPlaywrightService();

      // Create site record first
      const site = await db.universalSites.create(organizationId, {
        url: data.site_url,
        name: data.site_name || data.site_url,
        authType: data.credentials ? 'session' : 'none',
        credentials: data.credentials || {}
      });

      console.log('[Site Manager] Universal site record created:', site.id);

      // Test connection with Playwright
      try {
        const result = await playwrightService.connect(
          site.id,
          data.site_url,
          data.credentials
        );

        // Update connection status
        await db.universalSites.updateConnectionStatus(site.id, true, null);

        // Disconnect (we'll reconnect when needed)
        await playwrightService.disconnect(result.contextId);

        console.log('[Site Manager] Universal site connected successfully');

        return {
          platform: 'universal',
          site: { ...site, platform_type: 'universal', is_connected: true },
          connectionInfo: result
        };

      } catch (error) {
        // Update connection status with error
        await db.universalSites.updateConnectionStatus(site.id, false, error.message);
        throw error;
      }

    } catch (error) {
      console.error('[Site Manager] Universal site connection error:', error);
      throw error;
    }
  }

  /**
   * Detect sections on a site (platform-agnostic)
   * @param {string} siteId - UUID of the site
   * @param {string} pageUrl - Optional page URL (for universal sites)
   * @returns {Array} - Detected sections
   */
  async detectSections(siteId, pageUrl = null) {
    try {
      const result = await this.getSite(siteId);

      if (!result) {
        throw new Error('Site not found');
      }

      const { platform, site } = result;

      if (platform === 'wordpress') {
        // Use WordPress REST API
        const WordPressClient = require('./wordpress');

        const wp_app_password = Buffer.from(site.wp_app_password_encrypted, 'base64').toString('utf-8');

        const client = new WordPressClient(
          site.site_url,
          site.wp_username,
          wp_app_password
        );

        // Get pages/posts with sections
        const pages = await client.getPages();
        const posts = await client.getPosts();

        console.log(`[Site Manager] WordPress: Found ${pages.length} pages, ${posts.length} posts`);

        return {
          pages,
          posts
        };

      } else {
        // Use Playwright for universal sites
        const playwrightService = await this.getPlaywrightService();

        const connection = await playwrightService.connect(
          site.id,
          pageUrl || site.site_url
        );

        const sections = await playwrightService.detectSections(
          connection.contextId,
          pageUrl || site.site_url
        );

        // Save detected sections to database
        await db.universalSites.updateDetectedSections(site.id, sections);

        // Disconnect
        await playwrightService.disconnect(connection.contextId);

        console.log(`[Site Manager] Universal: Detected ${sections.length} sections`);

        return sections;
      }

    } catch (error) {
      console.error('[Site Manager] Section detection error:', error);
      throw error;
    }
  }

  /**
   * Update content on a site (platform-agnostic)
   * @param {string} siteId - UUID of the site
   * @param {Object} updateData - Update parameters (varies by platform)
   * @returns {Object} - Update result
   */
  async updateContent(siteId, updateData) {
    try {
      const result = await this.getSite(siteId);

      if (!result) {
        throw new Error('Site not found');
      }

      const { platform, site } = result;

      if (platform === 'wordpress') {
        // Use WordPress REST API
        const WordPressClient = require('./wordpress');

        const wp_app_password = Buffer.from(site.wp_app_password_encrypted, 'base64').toString('utf-8');

        const client = new WordPressClient(
          site.site_url,
          site.wp_username,
          wp_app_password
        );

        // Update page or post
        if (updateData.contentType === 'page') {
          const result = await client.updatePage(updateData.contentId, {
            content: updateData.content
          });
          return result;
        } else if (updateData.contentType === 'post') {
          const result = await client.updatePost(updateData.contentId, {
            content: updateData.content
          });
          return result;
        }

      } else {
        // Use Playwright for universal sites
        const playwrightService = await this.getPlaywrightService();

        const connection = await playwrightService.connect(
          site.id,
          updateData.pageUrl
        );

        const result = await playwrightService.updateContent(
          connection.contextId,
          updateData.pageUrl,
          updateData.sectionSelector,
          updateData.content
        );

        // Disconnect
        await playwrightService.disconnect(connection.contextId);

        return result;
      }

    } catch (error) {
      console.error('[Site Manager] Content update error:', error);
      throw error;
    }
  }

  /**
   * Disconnect/delete a site
   * @param {string} siteId - UUID of the site
   * @returns {Object} - Deletion result
   */
  async disconnectSite(siteId) {
    try {
      const result = await this.getSite(siteId);

      if (!result) {
        throw new Error('Site not found');
      }

      const { platform } = result;

      if (platform === 'wordpress') {
        await db.wordpressSites.delete(siteId);
      } else {
        await db.universalSites.delete(siteId);
      }

      console.log(`[Site Manager] Site disconnected: ${siteId} (${platform})`);

      return {
        success: true,
        message: `Site disconnected successfully`
      };

    } catch (error) {
      console.error('[Site Manager] Disconnect error:', error);
      throw error;
    }
  }

  /**
   * Get site statistics
   * @param {string} organizationId - UUID of the organization
   */
  async getSiteStats(organizationId) {
    try {
      const sites = await this.getAllSites(organizationId);

      const stats = {
        total: sites.length,
        wordpress: sites.filter(s => s.platform_type === 'wordpress').length,
        universal: sites.filter(s => s.platform_type === 'universal').length,
        connected: sites.filter(s => s.is_connected).length
      };

      return stats;

    } catch (error) {
      console.error('[Site Manager] Stats error:', error);
      throw error;
    }
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown() {
    console.log('[Site Manager] Shutting down...');
    if (playwrightServiceInstance) {
      await playwrightServiceInstance.shutdown();
      playwrightServiceInstance = null;
    }
    console.log('[Site Manager] Shutdown complete');
  }
}

module.exports = SiteManager;
