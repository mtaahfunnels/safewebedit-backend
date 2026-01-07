/**
 * Publishing Service
 * Handles safe publishing of generated content to WordPress slots
 */

const WordPressClient = require('./wordpress');
const SlotParser = require('./slotParser');

class PublishingService {
  /**
   * Publish generated content to a WordPress slot
   * @param {Object} params - Publishing parameters
   * @returns {Promise<Object>} Publishing result
   */
  async publishToSlot(params) {
    const {
      wordpress_site,
      slot,
      generated_content,
    } = params;

    try {
      // Decrypt WordPress password
      const wp_password = this._decryptPassword(wordpress_site.wp_app_password_encrypted);

      // Create WordPress client
      const wpClient = new WordPressClient(
        wordpress_site.site_url,
        wordpress_site.wp_username,
        wp_password
      );

      // Fetch current page content from WordPress
      const pageResult = await wpClient.getPage(slot.wp_page_id);

      if (!pageResult.success) {
        return {
          success: false,
          error: 'Failed to fetch page from WordPress',
          details: pageResult.error,
        };
      }

      const currentPageContent = pageResult.page.content;

      // Verify slot marker exists on the page
      const markerExists = SlotParser.hasSlot(currentPageContent, slot.marker_name);

      if (!markerExists) {
        return {
          success: false,
          error: `Slot marker "${slot.marker_name}" not found on WordPress page`,
          message: 'Please add the slot markers to your WordPress page first',
          instructions: {
            opening_marker: `<!-- SWE:SLOT:${slot.marker_name} -->`,
            closing_marker: `<!-- /SWE:SLOT:${slot.marker_name} -->`,
          },
        };
      }

      // Get old content for backup
      const oldContent = SlotParser.getSlotContent(currentPageContent, slot.marker_name);

      // Replace slot content with new generated content
      const replaceResult = SlotParser.replaceSlotContent(
        currentPageContent,
        slot.marker_name,
        generated_content
      );

      if (!replaceResult.success) {
        return {
          success: false,
          error: 'Failed to replace slot content',
          details: replaceResult.error,
        };
      }

      console.log('[PUBLISH] Replacing content:', {
        page_id: slot.wp_page_id,
        marker: slot.marker_name,
        old_length: oldContent ? oldContent.length : 0,
        new_length: generated_content.length,
      });

      // Update WordPress page
      const updateResult = await wpClient.updatePage(slot.wp_page_id, {
        content: replaceResult.html,
      });

      if (!updateResult.success) {
        return {
          success: false,
          error: 'Failed to update WordPress page',
          details: updateResult.error,
        };
      }

      console.log('[PUBLISH] Published successfully:', {
        page: updateResult.page.title,
        link: updateResult.page.link,
      });

      return {
        success: true,
        wordpress_page: {
          id: updateResult.page.id,
          title: updateResult.page.title,
          link: updateResult.page.link,
          modified: updateResult.page.modified,
        },
        slot_update: {
          marker_name: slot.marker_name,
          old_content: oldContent,
          new_content: generated_content,
        },
      };
    } catch (error) {
      console.error('[PUBLISH] Error:', error);
      return {
        success: false,
        error: 'Publishing failed',
        message: error.message || 'An unknown error occurred',
      };
    }
  }

  /**
   * Verify slot markers exist before publishing
   * @param {Object} wordpress_site - WordPress site object
   * @param {Object} slot - Slot object
   * @returns {Promise<Object>} Verification result
   */
  async verifySlotMarkers(wordpress_site, slot) {
    try {
      const wp_password = this._decryptPassword(wordpress_site.wp_app_password_encrypted);
      const wpClient = new WordPressClient(
        wordpress_site.site_url,
        wordpress_site.wp_username,
        wp_password
      );

      const pageResult = await wpClient.getPage(slot.wp_page_id);

      if (!pageResult.success) {
        return {
          verified: false,
          error: 'Failed to fetch page from WordPress',
          details: pageResult.error,
        };
      }

      const markerExists = SlotParser.hasSlot(pageResult.page.content, slot.marker_name);
      const currentContent = SlotParser.getSlotContent(pageResult.page.content, slot.marker_name);

      return {
        verified: markerExists,
        marker_name: slot.marker_name,
        marker_exists: markerExists,
        current_content: currentContent,
        page: {
          id: pageResult.page.id,
          title: pageResult.page.title,
          link: pageResult.page.link,
        },
        instructions: !markerExists ? {
          message: 'Add these markers to your WordPress page',
          opening_marker: `<!-- SWE:SLOT:${slot.marker_name} -->`,
          example_content: 'Your content here',
          closing_marker: `<!-- /SWE:SLOT:${slot.marker_name} -->`,
        } : null,
      };
    } catch (error) {
      console.error('[PUBLISH] Verify error:', error);
      return {
        verified: false,
        error: 'Verification failed',
        message: error.message,
      };
    }
  }

  /**
   * Get preview of what will be published
   * @param {Object} params - Preview parameters
   * @returns {Promise<Object>} Preview result
   */
  async getPublishPreview(params) {
    const {
      wordpress_site,
      slot,
      generated_content,
    } = params;

    try {
      const wp_password = this._decryptPassword(wordpress_site.wp_app_password_encrypted);
      const wpClient = new WordPressClient(
        wordpress_site.site_url,
        wordpress_site.wp_username,
        wp_password
      );

      const pageResult = await wpClient.getPage(slot.wp_page_id);

      if (!pageResult.success) {
        return {
          success: false,
          error: 'Failed to fetch page',
        };
      }

      const oldContent = SlotParser.getSlotContent(pageResult.page.content, slot.marker_name);
      const replaceResult = SlotParser.replaceSlotContent(
        pageResult.page.content,
        slot.marker_name,
        generated_content
      );

      return {
        success: replaceResult.success,
        preview: {
          page_title: pageResult.page.title,
          page_link: pageResult.page.link,
          slot_marker: slot.marker_name,
          old_content: oldContent,
          new_content: generated_content,
          old_length: oldContent ? oldContent.length : 0,
          new_length: generated_content.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Rollback to previous content
   * @param {Object} params - Rollback parameters
   * @returns {Promise<Object>} Rollback result
   */
  async rollbackContent(params) {
    const {
      wordpress_site,
      slot,
      previous_content,
    } = params;

    try {
      const wp_password = this._decryptPassword(wordpress_site.wp_app_password_encrypted);
      const wpClient = new WordPressClient(
        wordpress_site.site_url,
        wordpress_site.wp_username,
        wp_password
      );

      const pageResult = await wpClient.getPage(slot.wp_page_id);

      if (!pageResult.success) {
        return {
          success: false,
          error: 'Failed to fetch page',
        };
      }

      const replaceResult = SlotParser.replaceSlotContent(
        pageResult.page.content,
        slot.marker_name,
        previous_content
      );

      if (!replaceResult.success) {
        return {
          success: false,
          error: 'Failed to replace content',
        };
      }

      const updateResult = await wpClient.updatePage(slot.wp_page_id, {
        content: replaceResult.html,
      });

      if (!updateResult.success) {
        return {
          success: false,
          error: 'Failed to update page',
        };
      }

      console.log('[PUBLISH] Rolled back:', {
        page: updateResult.page.title,
        marker: slot.marker_name,
      });

      return {
        success: true,
        message: 'Content rolled back successfully',
        page: {
          title: updateResult.page.title,
          link: updateResult.page.link,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Decrypt WordPress password
   * @private
   */
  _decryptPassword(encrypted) {
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }
}

module.exports = PublishingService;
