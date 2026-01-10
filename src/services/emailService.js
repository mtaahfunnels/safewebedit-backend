/**
 * Email Service - SendGrid Integration
 * Handles all email sending for SafeWebEdit
 */

const sgMail = require('@sendgrid/mail');

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Send password reset email with reset link
 * @param {string} email - Recipient email address
 * @param {string} resetToken - Password reset token
 */
async function sendPasswordResetEmail(email, resetToken) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@safewebedit.com',
    subject: 'Reset Your Password - SafeWebEdit',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f9fafb;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <!-- Header -->
                <tr>
                  <td style="padding: 40px 40px 20px; text-align: center;">
                    <h1 style="margin: 0; font-size: 32px; font-weight: bold; background: linear-gradient(to right, #9333ea, #6b21a8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
                      SafeWebEdit
                    </h1>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 20px 40px;">
                    <h2 style="margin: 0 0 20px; font-size: 24px; color: #111827;">Reset Your Password</h2>
                    <p style="margin: 0 0 20px; font-size: 16px; color: #4b5563; line-height: 1.6;">
                      We received a request to reset your password for your SafeWebEdit account. Click the button below to create a new password:
                    </p>

                    <!-- Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                      <tr>
                        <td align="center">
                          <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(to right, #9333ea, #6b21a8); color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600;">
                            Reset Password
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin: 20px 0 0; font-size: 14px; color: #6b7280; line-height: 1.6;">
                      This link will expire in <strong>15 minutes</strong> for security reasons.
                    </p>
                  </td>
                </tr>

                <!-- Warning -->
                <tr>
                  <td style="padding: 20px 40px; background-color: #fef3c7; border-radius: 6px; margin: 20px 40px;">
                    <p style="margin: 0; font-size: 14px; color: #92400e; line-height: 1.6;">
                      <strong>Didn't request this?</strong><br>
                      If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
                    <p style="margin: 0; font-size: 14px; color: #9ca3af;">
                      SafeWebEdit - WordPress Content Management Platform
                    </p>
                    <p style="margin: 10px 0 0; font-size: 12px; color: #9ca3af;">
                      This is an automated email. Please do not reply.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
Reset Your Password - SafeWebEdit

We received a request to reset your password for your SafeWebEdit account.

Click the link below to create a new password:
${resetUrl}

This link will expire in 15 minutes for security reasons.

If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.

---
SafeWebEdit - WordPress Content Management Platform
This is an automated email. Please do not reply.
    `,
  };

  try {
    await sgMail.send(msg);
    console.log('[EMAIL] Password reset email sent to:', email);
  } catch (error) {
    console.error('[EMAIL] Failed to send password reset email:', error);
    throw new Error('Failed to send password reset email');
  }
}

/**
 * Send password reset confirmation email
 * @param {string} email - Recipient email address
 */
async function sendPasswordResetConfirmation(email) {
  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@safewebedit.com',
    subject: 'Password Reset Successful - SafeWebEdit',
    text: `Your password has been successfully reset.`,
  };

  try {
    await sgMail.send(msg);
    console.log('[EMAIL] Password reset confirmation sent to:', email);
  } catch (error) {
    console.error('[EMAIL] Failed to send password reset confirmation:', error);
  }
}

/**
 * Send password setup email for new accounts
 * @param {object} organization - Organization object with email and name
 * @param {string} setupToken - Password setup token
 */
async function sendPasswordSetupEmail(organization, setupToken) {
  const setupUrl = `${process.env.FRONTEND_URL}/setup-password?token=${setupToken}`;

  const msg = {
    to: organization.email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@safewebedit.com',
    subject: `Welcome to SafeWebEdit - Set Up Your Account`,
    text: `Welcome! Click here to set up your password: ${setupUrl}`,
  };

  try {
    await sgMail.send(msg);
    console.log('[EMAIL] Password setup email sent to:', organization.email);
  } catch (error) {
    console.error('[EMAIL] Failed to send password setup email:', error);
    throw new Error('Failed to send password setup email');
  }
}

/**
 * Send welcome email
 */
async function sendWelcomeEmail(email) {
  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@safewebedit.com',
    subject: 'Welcome to SafeWebEdit',
    text: 'Welcome to SafeWebEdit!',
  };

  try {
    await sgMail.send(msg);
    console.log('[EMAIL] Welcome email sent to:', email);
  } catch (error) {
    console.error('[EMAIL] Failed to send welcome email:', error);
  }
}

/**
 * Send magic link login email (Slack-inspired design)
 * @param {string} email - Recipient email address
 * @param {string} magicToken - Magic link token (48 hours)
 * @param {string} code - 6-digit backup code (10 minutes)
 */
async function sendMagicLinkEmail(email, magicToken, code) {
  const magicUrl = `${process.env.FRONTEND_URL}/api/auth/verify?token=${magicToken}`;

  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@safewebedit.com',
    subject: 'Your SafeWebEdit login link',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <tr>
                  <td style="padding: 40px 40px 20px; text-align: center;">
                    <h1 style="margin: 0; color: #007bff; font-size: 28px; font-weight: 700;">SafeWebEdit</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 20px 40px 0; text-align: center;">
                    <h2 style="margin: 0; color: #2c3e50; font-size: 24px; font-weight: 600;">Your login link is ready</h2>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 40px; text-align: center; color: #666; font-size: 16px; line-height: 1.5;">
                    Click the button below to login instantly. No password needed.
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center">
                          <a href="${magicUrl}" style="display: inline-block; padding: 16px 48px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 2px 4px rgba(0,123,255,0.3);">Login to SafeWebEdit</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 40px 24px; text-align: center; color: #999; font-size: 13px;">
                    This link expires in 48 hours and can only be used once.
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 40px;">
                    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 40px 16px; text-align: center; color: #666; font-size: 14px;">
                    Can't click the button? Use this code instead:
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 40px 24px; text-align: center;">
                    <div style="display: inline-block; padding: 16px 32px; background-color: #f8f9fa; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 28px; font-weight: 700; letter-spacing: 4px; color: #2c3e50; font-family: 'Courier New', monospace;">${code}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 40px 32px; text-align: center; color: #999; font-size: 13px;">
                    Go to <a href="${process.env.FRONTEND_URL}/login" style="color: #007bff; text-decoration: none;">safewebedit.com/login</a> and enter this code.<br>Code expires in 10 minutes.
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px;">
                    <p style="margin: 0; color: #999; font-size: 13px; text-align: center; line-height: 1.5;">If you didn't request this email, there's nothing to worry about — you can safely ignore it.</p>
                  </td>
                </tr>
              </table>
              <table width="600" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
                <tr>
                  <td style="padding: 20px 40px; text-align: center; color: #999; font-size: 12px;">
                    <p style="margin: 0 0 8px;">© 2026 SafeWebEdit. All rights reserved.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
Your SafeWebEdit login link

Click the link below to login instantly. No password needed.

${magicUrl}

This link expires in 48 hours and can only be used once.

---

Can't click the link? Use this code instead:

${code}

Go to ${process.env.FRONTEND_URL}/login and enter this code.
Code expires in 10 minutes.

---

If you didn't request this email, there's nothing to worry about — you can safely ignore it.

© 2026 SafeWebEdit. All rights reserved.
    `,
  };

  try {
    await sgMail.send(msg);
    console.log('[EMAIL] Magic link email sent to:', email);
  } catch (error) {
    console.error('[EMAIL] Failed to send magic link email:', error);
    throw new Error('Failed to send magic link email');
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendPasswordResetConfirmation,
  sendPasswordSetupEmail,
  sendWelcomeEmail,
  sendMagicLinkEmail,
};
