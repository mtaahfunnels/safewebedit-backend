/**
 * Session Manager
 * Handles persistent browser session storage with encryption
 * Allows users to stay logged into websites across browser restarts
 */

const fs = require('fs').promises;
const crypto = require('crypto');
const path = require('path');

class SessionManager {
  constructor() {
    this.sessionDir = './storage/sessions';
    this.encryptionKey = process.env.SESSION_ENCRYPTION_KEY;
    this.sessionStore = new Map(); // In-memory cache
    this.expiryHours = parseInt(process.env.SESSION_EXPIRY_HOURS || '24');

    if (!this.encryptionKey) {
      throw new Error('SESSION_ENCRYPTION_KEY must be set in environment variables');
    }

    console.log('[Session Manager] Initialized with expiry:', this.expiryHours, 'hours');
  }

  /**
   * Initialize the session manager
   * Creates storage directory if it doesn't exist
   */
  async initialize() {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      console.log('[Session Manager] Storage directory ready:', this.sessionDir);

      // Load existing sessions into memory
      await this.loadExistingSessions();
    } catch (error) {
      console.error('[Session Manager] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Load existing sessions from disk into memory
   */
  async loadExistingSessions() {
    try {
      const files = await fs.readdir(this.sessionDir);
      let loadedCount = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          const siteId = file.replace('.json', '');
          const sessionPath = path.join(this.sessionDir, file);

          try {
            const stats = await fs.stat(sessionPath);
            const expiresAt = stats.mtime.getTime() + (this.expiryHours * 60 * 60 * 1000);

            if (Date.now() < expiresAt) {
              this.sessionStore.set(siteId, {
                path: sessionPath,
                expires: expiresAt,
                lastAccessed: stats.mtime.getTime()
              });
              loadedCount++;
            } else {
              // Delete expired session
              await fs.unlink(sessionPath);
              console.log(`[Session Manager] Deleted expired session: ${siteId}`);
            }
          } catch (error) {
            console.error(`[Session Manager] Error loading session ${siteId}:`, error);
          }
        }
      }

      console.log(`[Session Manager] Loaded ${loadedCount} valid sessions`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[Session Manager] Error loading sessions:', error);
      }
    }
  }

  /**
   * Save a browser session (cookies, localStorage, sessionStorage)
   * @param {string} siteId - Unique site identifier
   * @param {Object} storageState - Playwright storage state object
   */
  async saveSession(siteId, storageState) {
    try {
      const sessionPath = path.join(this.sessionDir, `${siteId}.json`);

      // Encrypt the session data
      const encrypted = this.encrypt(JSON.stringify(storageState));

      // Write to disk
      await fs.writeFile(sessionPath, encrypted, 'utf8');

      // Update in-memory cache
      const expiresAt = Date.now() + (this.expiryHours * 60 * 60 * 1000);
      this.sessionStore.set(siteId, {
        path: sessionPath,
        expires: expiresAt,
        lastAccessed: Date.now()
      });

      console.log(`[Session Manager] Session saved for site: ${siteId}`);
      return true;
    } catch (error) {
      console.error(`[Session Manager] Failed to save session for ${siteId}:`, error);
      throw error;
    }
  }

  /**
   * Load a browser session
   * @param {string} siteId - Unique site identifier
   * @returns {Object|null} - Playwright storage state or null if not found/expired
   */
  async loadSession(siteId) {
    const session = this.sessionStore.get(siteId);

    // Check if session exists and is not expired
    if (!session) {
      console.log(`[Session Manager] No session found for: ${siteId}`);
      return null;
    }

    if (Date.now() > session.expires) {
      console.log(`[Session Manager] Session expired for: ${siteId}`);
      await this.deleteSession(siteId);
      return null;
    }

    try {
      // Read encrypted session from disk
      const encrypted = await fs.readFile(session.path, 'utf8');

      // Decrypt and parse
      const decrypted = this.decrypt(encrypted);
      const storageState = JSON.parse(decrypted);

      // Update last accessed time
      session.lastAccessed = Date.now();

      console.log(`[Session Manager] Session loaded for: ${siteId}`);
      return storageState;
    } catch (error) {
      console.error(`[Session Manager] Failed to load session for ${siteId}:`, error);
      await this.deleteSession(siteId);
      return null;
    }
  }

  /**
   * Delete a session
   * @param {string} siteId - Unique site identifier
   */
  async deleteSession(siteId) {
    const session = this.sessionStore.get(siteId);

    if (session) {
      try {
        await fs.unlink(session.path);
        console.log(`[Session Manager] Session deleted: ${siteId}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error(`[Session Manager] Error deleting session ${siteId}:`, error);
        }
      }
    }

    this.sessionStore.delete(siteId);
  }

  /**
   * Check if a session exists and is valid
   * @param {string} siteId - Unique site identifier
   * @returns {boolean}
   */
  hasValidSession(siteId) {
    const session = this.sessionStore.get(siteId);
    return session && Date.now() < session.expires;
  }

  /**
   * Encrypt data using AES-256-CBC
   * @param {string} data - Data to encrypt
   * @returns {string} - Encrypted data (hex encoded)
   */
  encrypt(data) {
    try {
      // Create a hash of the encryption key to ensure it's the right length
      const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
      const iv = crypto.randomBytes(16);

      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Prepend IV to encrypted data (needed for decryption)
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('[Session Manager] Encryption failed:', error);
      throw error;
    }
  }

  /**
   * Decrypt data using AES-256-CBC
   * @param {string} data - Encrypted data (hex encoded with IV prepended)
   * @returns {string} - Decrypted data
   */
  decrypt(data) {
    try {
      // Split IV from encrypted data
      const parts = data.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const encryptedData = parts[1];

      // Create a hash of the encryption key
      const key = crypto.createHash('sha256').update(this.encryptionKey).digest();

      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('[Session Manager] Decryption failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup expired sessions
   * @returns {number} - Number of sessions cleaned up
   */
  async cleanupExpiredSessions() {
    const now = Date.now();
    const toDelete = [];

    for (const [siteId, session] of this.sessionStore) {
      if (now > session.expires) {
        toDelete.push(siteId);
      }
    }

    for (const siteId of toDelete) {
      await this.deleteSession(siteId);
    }

    if (toDelete.length > 0) {
      console.log(`[Session Manager] Cleaned up ${toDelete.length} expired sessions`);
    }

    return toDelete.length;
  }

  /**
   * Get session statistics
   */
  getStats() {
    const now = Date.now();
    let validCount = 0;
    let expiredCount = 0;

    for (const [, session] of this.sessionStore) {
      if (now < session.expires) {
        validCount++;
      } else {
        expiredCount++;
      }
    }

    return {
      total: this.sessionStore.size,
      valid: validCount,
      expired: expiredCount,
      expiryHours: this.expiryHours
    };
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown() {
    console.log('[Session Manager] Shutting down...');
    await this.cleanupExpiredSessions();
    this.sessionStore.clear();
    console.log('[Session Manager] Shutdown complete');
  }
}

module.exports = SessionManager;
