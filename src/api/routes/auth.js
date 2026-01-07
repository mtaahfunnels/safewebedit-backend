/**
 * Authentication API Routes
 * Handles password setup, validation, and login for users
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../../services/database');
const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

/**
 * POST /api/auth/login
 * Authenticate user with Keycloak and return JWT token
 */
router.post('/login', async (req, res) => {
  console.log('[Auth] Login attempt');

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Get organization by email
    const orgResult = await db.query(
      'SELECT * FROM organizations WHERE email = $1',
      [email]
    );

    if (orgResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const organization = orgResult.rows[0];

    // Authenticate with Keycloak using direct token endpoint
    const fetch = require('node-fetch');
    try {
      const tokenResponse = await fetch(
        'http://localhost:8081/safewebedit-auth/realms/safewebedit/protocol/openid-connect/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: 'safewebedit-dashboard',
            client_secret: 'zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT',
            grant_type: 'password',
            username: organization.id,
            password: password,
          }),
        }
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[Auth] Keycloak authentication failed:', errorText);
        return res.status(401).json({ success: false, error: 'Invalid email or password' });
      }

      const keycloakTokens = await tokenResponse.json();
      console.log('[Auth] Keycloak authentication successful for:', email);

      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'safewebedit-secret-key-2026';

      const token = jwt.sign(
        { organizationId: organization.id, email: organization.email, name: organization.name },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.json({ success: true, token: token, user: { id: organization.id, email: organization.email, name: organization.name } });

    } catch (error) {
      console.error('[Auth] Keycloak authentication error:', error.message);
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

  } catch (error) {
    console.error('[Auth] Login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Login failed: ' + error.message
    });
  }
});


/**
 * POST /api/auth/validate-setup-token
 * Validate a password setup token
 */
router.post('/validate-setup-token', async (req, res) => {
  console.log('[Auth] Validating password setup token');

  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required',
      });
    }

    // Check token in database
    const result = await db.query(
      `SELECT organization_id, expires_at, used
       FROM password_reset_tokens
       WHERE token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Invalid setup token',
      });
    }

    const tokenData = result.rows[0];

    // Check if already used
    if (tokenData.used) {
      return res.status(400).json({
        success: false,
        error: 'This setup link has already been used',
      });
    }

    // Check if expired
    if (new Date() > new Date(tokenData.expires_at)) {
      return res.status(400).json({
        success: false,
        error: 'This setup link has expired. Please request a new one.',
      });
    }

    // Token is valid
    return res.json({
      success: true,
      message: 'Token is valid',
    });

  } catch (error) {
    console.error('[Auth] Error validating token:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to validate token',
    });
  }
});

/**
 * POST /api/auth/setup-password
 * Set password on EXISTING Keycloak user (created by webhook)
 */
router.post('/setup-password', async (req, res) => {
  console.log('[Auth] Setting up password for new user');

  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: 'Token and password are required',
      });
    }

    // Validate password strength (relaxed - only require 8 characters)
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters',
      });
    }

    // Get token from database
    const tokenResult = await db.query(
      `SELECT organization_id, expires_at, used
       FROM password_reset_tokens
       WHERE token = $1`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Invalid setup token',
      });
    }

    const tokenData = tokenResult.rows[0];

    // Check if already used
    if (tokenData.used) {
      return res.status(400).json({
        success: false,
        error: 'This setup link has already been used',
      });
    }

    // Check if expired
    if (new Date() > new Date(tokenData.expires_at)) {
      return res.status(400).json({
        success: false,
        error: 'This setup link has expired',
      });
    }

    // Get organization
    const orgResult = await db.query(
      'SELECT * FROM organizations WHERE id = $1',
      [tokenData.organization_id]
    );

    if (orgResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found',
      });
    }

    const organization = orgResult.rows[0];

    // Set password on EXISTING Keycloak user
    await setKeycloakPassword(organization, password);

    // Mark token as used
    await db.query(
      'UPDATE password_reset_tokens SET used = true WHERE token = $1',
      [token]
    );

    // Mark email as verified
    await db.query(
      'UPDATE organizations SET email_verified = true WHERE id = $1',
      [organization.id]
    );

    console.log('[Auth] Password setup completed for:', organization.email);

    return res.json({
      success: true,
      message: 'Password set successfully',
    });

  } catch (error) {
    console.error('[Auth] Error setting up password:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to set up password: ' + error.message,
    });
  }
});

/**
 * GET /api/auth/error
 * Auth error page (for Next.js auth compatibility)
 */
router.get('/error', (req, res) => {
  const error = req.query.error || 'Unknown error';
  res.json({
    error: error,
    message: 'Authentication error',
    redirect: '/login'
  });
});

/**
 * GET /api/auth/session
 * Session endpoint (for Next.js auth compatibility)
 */
router.get('/session', (req, res) => {
  // Return empty session for now
  res.json({ user: null });
});

/**
 * Set password on EXISTING Keycloak user (created by webhook)
 * Uses Keycloak Admin Client instead of kcadm.sh
 */
async function setKeycloakPassword(organization, password) {
  console.log('[Auth] Setting Keycloak password for:', organization.email);

  try {
    // Initialize Keycloak Admin Client
    const kcAdminClient = new KcAdminClient({
      baseUrl: 'http://localhost:8081/safewebedit-auth',
      realmName: 'master',
    });

    // Authenticate with admin credentials
    await kcAdminClient.auth({
      username: 'admin',
      password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'SafeWebEditAdmin2026!',
      grantType: 'password',
      clientId: 'admin-cli',
    });

    // Switch to safewebedit realm
    kcAdminClient.setConfig({ realmName: 'safewebedit' });

    // Find user by username (which is organization.id from webhook)
    const users = await kcAdminClient.users.find({ username: organization.id });

    if (!users || users.length === 0) {
      throw new Error(`Keycloak user not found for organization: ${organization.id}`);
    }

    const keycloakUserId = users[0].id;
    console.log('[Auth] Found Keycloak user:', keycloakUserId);

    // Set password
    await kcAdminClient.users.resetPassword({
      id: keycloakUserId,
      credential: {
        temporary: false,
        type: 'password',
        value: password
      }
    });

    // Update emailVerified to true
    await kcAdminClient.users.update(
      { id: keycloakUserId },
      { emailVerified: true }
    );

    console.log('[Auth] Password set and email verified for user:', keycloakUserId);

  } catch (error) {
    console.error('[Auth] Error setting Keycloak password:', error);
    throw error;
  }
}

/**
 * JWT Authentication Middleware
 * Verifies JWT token and extracts organization ID
 */
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token with JWT secret
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'safewebedit-secret-key-2026';

    const decoded = jwt.verify(token, JWT_SECRET);
    req.organizationId = decoded.organizationId;
    next();
  } catch (error) {
    console.error('[Auth] Token verification failed:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Export both router and middleware
module.exports = router;
module.exports.authenticateToken = authenticateToken;
