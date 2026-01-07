/**
 * Password Reset Routes
 * Handles password reset requests using Keycloak Admin API
 */

const express = require('express');
const router = express.Router();
const db = require('../../services/database');
const { sendPasswordResetEmail, sendPasswordResetConfirmation } = require('../../services/emailService');

// ====================================
// POST /api/password-reset/request
// Request password reset (send email with token)
// ====================================
router.post('/request', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Find organization by email
    const organization = await db.organizations.findByEmail(email.toLowerCase());

    // SECURITY: Always return success (prevent email enumeration)
    if (!organization) {
      console.log('[PASSWORD RESET] Request for non-existent email:', email);
      return res.json({ message: 'If an account exists, a reset link has been sent.' });
    }

    // Invalidate old tokens
    await db.query(
      'UPDATE password_reset_tokens SET used = TRUE WHERE organization_id = $1 AND used = FALSE',
      [organization.id]
    );

    // Create new token
    const tokenData = await db.passwordResetTokens.create(organization.id);

    // Send password reset email via SendGrid
    try {
      await sendPasswordResetEmail(email, tokenData.token);
    } catch (emailError) {
      console.error('[PASSWORD RESET] Failed to send email:', emailError);
      // Don't expose email sending errors to the user
    }

    res.json({ message: 'If an account exists, a reset link has been sent.' });
  } catch (error) {
    console.error('[PASSWORD RESET] Request error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

// ====================================
// POST /api/password-reset/reset
// Reset password using token + Keycloak Admin API
// ====================================
router.post('/reset', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    // Validate password
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Validate token
    const tokenData = await db.passwordResetTokens.findValidToken(token);

    if (!tokenData) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const axios = require('axios');

    // Get Keycloak admin token
    const tokenResp = await axios.post(
      'http://localhost:8081/safewebedit-auth/realms/master/protocol/openid-connect/token',
      new URLSearchParams({
        client_id: 'admin-cli',
        grant_type: 'password',
        username: process.env.KEYCLOAK_ADMIN_USER || 'admin',
        password: process.env.KEYCLOAK_ADMIN_PASSWORD,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const adminToken = tokenResp.data.access_token;

    // Get user by email from Keycloak
    const usersResp = await axios.get(
      `http://localhost:8081/safewebedit-auth/admin/realms/safewebedit/users?email=${encodeURIComponent(tokenData.email)}`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );

    if (!usersResp.data || usersResp.data.length === 0) {
      return res.status(404).json({ error: 'User not found in authentication system' });
    }

    const userId = usersResp.data[0].id;

    // Reset password in Keycloak
    await axios.put(
      `http://localhost:8081/safewebedit-auth/admin/realms/safewebedit/users/${userId}/reset-password`,
      {
        type: 'password',
        value: newPassword,
        temporary: false,
      },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Mark token as used
    await db.passwordResetTokens.markAsUsed(token);

    console.log('[PASSWORD RESET] Password reset successful for:', tokenData.email);

    // Send confirmation email
    try {
      await sendPasswordResetConfirmation(tokenData.email);
    } catch (emailError) {
      console.error('[PASSWORD RESET] Failed to send confirmation email:', emailError);
      // Don't fail the request if confirmation email fails
    }

    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    console.error('[PASSWORD RESET] Reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
