/**
 * Slot Parser Service
 * Handles parsing and manipulation of HTML comment markers for content slots
 *
 * Marker format: <!-- SWE:SLOT:SLOT_NAME -->content<!-- /SWE:SLOT:SLOT_NAME -->
 */

class SlotParser {
  /**
   * Parse HTML content and find all slots
   * @param {string} html - HTML content to parse
   * @returns {Array} Array of slot objects
   */
  static parseSlots(html) {
    if (!html || typeof html !== 'string') {
      return [];
    }

    const slots = [];
    const regex = /<!--\s*SWE:SLOT:([A-Z0-9_]+)\s*-->([\s\S]*?)<!--\s*\/SWE:SLOT:\1\s*-->/gi;
    let match;

    while ((match = regex.exec(html)) !== null) {
      const [fullMatch, slotName, content] = match;
      slots.push({
        marker_name: slotName,
        content: content.trim(),
        start_index: match.index,
        end_index: match.index + fullMatch.length,
        full_match: fullMatch,
      });
    }

    return slots;
  }

  /**
   * Check if HTML contains a specific slot marker
   * @param {string} html - HTML content to check
   * @param {string} markerName - Slot marker name (e.g., "HOME_ANNOUNCEMENT")
   * @returns {boolean} True if slot exists
   */
  static hasSlot(html, markerName) {
    if (!html || !markerName) {
      return false;
    }

    const regex = new RegExp(
      `<!--\\s*SWE:SLOT:${markerName}\\s*-->`,
      'i'
    );
    return regex.test(html);
  }

  /**
   * Extract content from a specific slot
   * @param {string} html - HTML content
   * @param {string} markerName - Slot marker name
   * @returns {string|null} Slot content or null if not found
   */
  static getSlotContent(html, markerName) {
    if (!html || !markerName) {
      return null;
    }

    const regex = new RegExp(
      `<!--\\s*SWE:SLOT:${markerName}\\s*-->([\s\S]*?)<!--\\s*\\/SWE:SLOT:${markerName}\\s*-->`,
      'i'
    );
    const match = html.match(regex);

    return match ? match[1].trim() : null;
  }

  /**
   * Replace content in a specific slot
   * @param {string} html - Original HTML content
   * @param {string} markerName - Slot marker name
   * @param {string} newContent - New content to insert
   * @returns {Object} Result with success status and updated HTML
   */
  static replaceSlotContent(html, markerName, newContent) {
    if (!html || !markerName) {
      return {
        success: false,
        error: 'Invalid HTML or marker name',
        html: html,
      };
    }

    // Check if slot exists
    if (!this.hasSlot(html, markerName)) {
      return {
        success: false,
        error: `Slot marker "${markerName}" not found in content`,
        html: html,
      };
    }

    // Replace content between markers
    const regex = new RegExp(
      `(<!--\\s*SWE:SLOT:${markerName}\\s*-->)([\\s\\S]*?)(<!--\\s*\\/SWE:SLOT:${markerName}\\s*-->)`,
      'i'
    );

    const updatedHtml = html.replace(regex, (match, openMarker, oldContent, closeMarker) => {
      return `${openMarker}\n${newContent}\n${closeMarker}`;
    });

    return {
      success: true,
      html: updatedHtml,
      old_content: this.getSlotContent(html, markerName),
      new_content: newContent,
    };
  }

  /**
   * Create new slot markers around existing content
   * @param {string} html - Original HTML content
   * @param {string} markerName - Slot marker name to create
   * @param {string} targetContent - Content to wrap with markers (must exist in HTML)
   * @returns {Object} Result with success status and updated HTML
   */
  static createSlot(html, markerName, targetContent) {
    if (!html || !markerName || !targetContent) {
      return {
        success: false,
        error: 'Invalid parameters',
        html: html,
      };
    }

    // Validate marker name format (uppercase alphanumeric and underscores only)
    if (!/^[A-Z0-9_]+$/.test(markerName)) {
      return {
        success: false,
        error: 'Marker name must be uppercase letters, numbers, and underscores only',
        html: html,
      };
    }

    // Check if slot already exists
    if (this.hasSlot(html, markerName)) {
      return {
        success: false,
        error: `Slot marker "${markerName}" already exists`,
        html: html,
      };
    }

    // Check if target content exists in HTML
    if (!html.includes(targetContent)) {
      return {
        success: false,
        error: 'Target content not found in HTML',
        html: html,
      };
    }

    // Wrap target content with markers
    const openMarker = `<!-- SWE:SLOT:${markerName} -->`;
    const closeMarker = `<!-- /SWE:SLOT:${markerName} -->`;
    const updatedHtml = html.replace(
      targetContent,
      `${openMarker}\n${targetContent}\n${closeMarker}`
    );

    return {
      success: true,
      html: updatedHtml,
      marker_name: markerName,
    };
  }

  /**
   * Remove slot markers (but keep the content)
   * @param {string} html - HTML content
   * @param {string} markerName - Slot marker name to remove
   * @returns {Object} Result with success status and updated HTML
   */
  static removeSlot(html, markerName) {
    if (!html || !markerName) {
      return {
        success: false,
        error: 'Invalid HTML or marker name',
        html: html,
      };
    }

    if (!this.hasSlot(html, markerName)) {
      return {
        success: false,
        error: `Slot marker "${markerName}" not found`,
        html: html,
      };
    }

    // Remove markers but keep content
    const regex = new RegExp(
      `<!--\\s*SWE:SLOT:${markerName}\\s*-->([\\s\\S]*?)<!--\\s*\\/SWE:SLOT:${markerName}\\s*-->`,
      'gi'
    );

    const updatedHtml = html.replace(regex, (match, content) => {
      return content.trim();
    });

    return {
      success: true,
      html: updatedHtml,
    };
  }

  /**
   * Validate marker name format
   * @param {string} markerName - Marker name to validate
   * @returns {Object} Validation result
   */
  static validateMarkerName(markerName) {
    if (!markerName || typeof markerName !== 'string') {
      return {
        valid: false,
        error: 'Marker name is required',
      };
    }

    if (markerName.length < 3) {
      return {
        valid: false,
        error: 'Marker name must be at least 3 characters',
      };
    }

    if (markerName.length > 50) {
      return {
        valid: false,
        error: 'Marker name must be 50 characters or less',
      };
    }

    if (!/^[A-Z0-9_]+$/.test(markerName)) {
      return {
        valid: false,
        error: 'Marker name must be uppercase letters, numbers, and underscores only',
      };
    }

    return {
      valid: true,
      marker_name: markerName,
    };
  }

  /**
   * Generate a safe marker name from a label
   * @param {string} label - Human-readable label (e.g., "Home Announcement")
   * @returns {string} Safe marker name (e.g., "HOME_ANNOUNCEMENT")
   */
  static generateMarkerName(label) {
    if (!label || typeof label !== 'string') {
      return 'CONTENT_SLOT';
    }

    return label
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 50);
  }

  /**
   * Get slot statistics from HTML
   * @param {string} html - HTML content
   * @returns {Object} Statistics about slots
   */
  static getSlotStats(html) {
    const slots = this.parseSlots(html);

    return {
      total_slots: slots.length,
      slot_names: slots.map(s => s.marker_name),
      total_content_length: slots.reduce((sum, s) => sum + s.content.length, 0),
      slots: slots.map(s => ({
        marker_name: s.marker_name,
        content_length: s.content.length,
        content_preview: s.content.substring(0, 100) + (s.content.length > 100 ? '...' : ''),
      })),
    };
  }
}

module.exports = SlotParser;
