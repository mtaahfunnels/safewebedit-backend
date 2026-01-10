/**
 * Authentication Routes - Magic Link + 6-Digit Code
 * Passwordless authentication with auto sign-out on inactivity
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { sendMagicLinkEmail } = require('../../services/emailService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Generate readable 6-character code (easier to type than random)
 * No ambiguous characters (0, O, 1, I, l)
 */
function generateReadableCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    if (i === 3) code += '-';  // Add dash for readability: OUM-6WH
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * POST /api/auth/login
 * Send magic link + 6-digit code to email
 */
router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Check if user exists
    const userResult = await pool.query(
      'SELECT id FROM organizations WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'No account found with this email. Please sign up first.'
      });
    }

    const userId = userResult.rows[0].id;

    // Generate magic link token (48 hours, one-time use)
    const magicToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);

    // Generate 6-digit code (10 minutes, one-time use)
    const code = generateReadableCode();
    const codeExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // Store both in database
    await pool.query(
      `INSERT INTO login_tokens (email, user_id, magic_token, code, expires_at, code_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [email.toLowerCase(), userId, magicToken, code, tokenExpiry, codeExpiry]
    );

    // Send email with BOTH options
    await sendMagicLinkEmail(email, magicToken, code);

    console.log('[AUTH] Login link sent to:', email);
    console.log('[AUTH] Code:', code, '(expires in 10 min)');

    res.json({
      success: true,
      message: 'Check your email for your login link and code'
    });

  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({ error: 'Failed to send login link' });
  }
});

/**
 * GET /api/auth/verify
 * Verify magic link token (clicked from email)
 */
router.get('/verify', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=missing_token`);
    }

    // Find valid, unused token
    const result = await pool.query(
      `SELECT * FROM login_tokens
       WHERE magic_token = $1 AND expires_at > NOW() AND used = FALSE`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_token`);
    }

    const loginToken = result.rows[0];

    // Mark token as used
    await pool.query(
      `UPDATE login_tokens SET used = TRUE WHERE magic_token = $1`,
      [token]
    );

    // Get user details
    const userResult = await pool.query(
      'SELECT id, email, name FROM organizations WHERE id = $1',
      [loginToken.user_id]
    );

    if (userResult.rows.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=user_not_found`);
    }

    const user = userResult.rows[0];

    // Create session token (JWT with 30 day max, but will be killed by inactivity timeout)
    const sessionToken = jwt.sign(
      {
        user_id: user.id,
        email: user.email,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Track session for activity monitoring
    await pool.query(
      `INSERT INTO user_sessions (user_id, token, last_activity)
       VALUES ($1, $2, NOW())`,
      [user.id, sessionToken]
    );

    console.log('[AUTH] User logged in via magic link:', user.email);

    // Redirect to dashboard with token
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?token=${sessionToken}`);

  } catch (error) {
    console.error('[AUTH] Verify error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`);
  }
});

/**
 * POST /api/auth/verify-code
 * Verify 6-digit code (backup method)
 */
router.post('/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code required' });
    }

    // Find valid, unused code
    const result = await pool.query(
      `SELECT * FROM login_tokens
       WHERE email = $1 AND code = $2 AND code_expires_at > NOW() AND used = FALSE`,
      [email.toLowerCase(), code.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid or expired code. Request a new login link.'
      });
    }

    const loginToken = result.rows[0];

    // Mark token as used
    await pool.query(
      `UPDATE login_tokens SET used = TRUE WHERE email = $1 AND code = $2`,
      [email.toLowerCase(), code.toUpperCase()]
    );

    // Get user details
    const userResult = await pool.query(
      'SELECT id, email, name FROM organizations WHERE id = $1',
      [loginToken.user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Create session token (same as magic link)
    const sessionToken = jwt.sign(
      {
        user_id: user.id,
        email: user.email,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Track session
    await pool.query(
      `INSERT INTO user_sessions (user_id, token, last_activity)
       VALUES ($1, $2, NOW())`,
      [user.id, sessionToken]
    );

    console.log('[AUTH] User logged in via code:', user.email);

    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });

  } catch (error) {
    console.error('[AUTH] Verify code error:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

/**
 * POST /api/auth/logout
 * Explicit sign out (revoke session)
 */
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }

    // Delete session
    await pool.query(
      `DELETE FROM user_sessions WHERE token = $1`,
      [token]
    );

    console.log('[AUTH] User logged out');

    res.json({ success: true });

  } catch (error) {
    console.error('[AUTH] Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

/**
 * Activity Tracking Middleware
 * Add this to ALL protected API routes
 * Auto-logout after 2 minutes (FOR TESTING) of inactivity
 */
async function trackActivity(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return next(); // No token = not authenticated, let route handle it
    }

    // Update last activity timestamp
    await pool.query(
      `UPDATE user_sessions SET last_activity = NOW() WHERE token = $1`,
      [token]
    );

    // Check if session is still active (15 min since last activity)
    const sessionResult = await pool.query(
      `SELECT * FROM user_sessions
       WHERE token = $1 AND last_activity > NOW() - INTERVAL '2 minutes'`,
      [token]
    );

    if (sessionResult.rows.length === 0) {
      // Session expired due to inactivity
      await pool.query(`DELETE FROM user_sessions WHERE token = $1`, [token]);

      return res.status(401).json({
        error: 'Session expired due to inactivity',
        code: 'INACTIVITY_TIMEOUT'
      });
    }

    // Session is active, continue
    next();

  } catch (error) {
    console.error('[AUTH] Activity tracking error:', error);
    next(); // Don't block request on activity tracking failure
  }
}

/**
 * GET /api/auth/session
 * Check if current session is still valid
 */
router.get('/session', trackActivity, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ valid: false });
    }

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check session exists and is active
    const sessionResult = await pool.query(
      `SELECT * FROM user_sessions
       WHERE token = $1 AND last_activity > NOW() - INTERVAL '2 minutes'`,
      [token]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ valid: false });
    }

    res.json({
      valid: true,
      user: {
        id: decoded.user_id,
        email: decoded.email,
        name: decoded.name
      }
    });

  } catch (error) {
    console.error('[AUTH] Session check error:', error);
    res.status(401).json({ valid: false });
  }
});


/**
 * JWT Authentication Middleware
 * Verifies JWT tokens for protected routes
 */
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token with JWT secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.organizationId = decoded.organizationId || decoded.user_id;
    req.userId = decoded.user_id;
    req.userEmail = decoded.email;
    next();
  } catch (error) {
    console.error('[Auth] Token verification failed:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}



module.exports = { router, trackActivity, authenticateToken };
/**
 * POST /api/auth/signup
 * Create new account without password (passwordless signup)
 */
router.post('/signup', async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email required' });
    }

    // Check if email already exists
    const existingUser = await pool.query(
      'SELECT id FROM organizations WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      // Email exists - send them a login link seamlessly
      console.log('[AUTH] Existing user tried to sign up again:', email);
      // Generate magic link and code
      const magicToken = crypto.randomBytes(32).toString('hex');
      const code = generateReadableCode();
      const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const codeExpiry = new Date(Date.now() + 10 * 60 * 1000);
      
      await pool.query(
        `INSERT INTO login_tokens (user_id, email, magic_token, code, expires_at, code_expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [existingUser.rows[0].id, email.toLowerCase(), magicToken, code, tokenExpiry, codeExpiry]
      );
      
      // Send magic link email
      
      // Send magic link email
      await sendMagicLinkEmail(email, magicToken, code);
      
      return res.json({
        success: true,
        message: 'Check your email for your login link.'
      });
    }

    // Create new organization (no password needed)
    const result = await pool.query(
      'INSERT INTO organizations (name, slug, email, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, email, name',
      [name, email.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50), email.toLowerCase()] // Start with 10 free credits
    );

    const newUser = result.rows[0];

    console.log('[AUTH] New user signed up:', newUser.email);

    res.json({
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name
      },
      message: 'Account created successfully. Check your email for magic link.'
    });

  } catch (error) {
    console.error('[AUTH] Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});
