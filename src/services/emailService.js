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

                    <p style="margin: 20px 0; font-size: 14px; color: #6b7280; line-height: 1.6;">
                      Or copy and paste this link into your browser:
                    </p>
                    <p style="margin: 0 0 20px; font-size: 14px; color: #9333ea; word-break: break-all;">
                      ${resetUrl}
                    </p>

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
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset Successful</title>
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

                <!-- Success Icon -->
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <div style="display: inline-block; width: 64px; height: 64px; background-color: #d1fae5; border-radius: 50%; line-height: 64px; font-size: 32px;">
                      ✓
                    </div>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 20px 40px;">
                    <h2 style="margin: 0 0 20px; font-size: 24px; color: #111827; text-align: center;">Password Reset Successful</h2>
                    <p style="margin: 0 0 20px; font-size: 16px; color: #4b5563; line-height: 1.6; text-align: center;">
                      Your password has been successfully reset. You can now log in to your SafeWebEdit account with your new password.
                    </p>

                    <!-- Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                      <tr>
                        <td align="center">
                          <a href="${process.env.FRONTEND_URL}/login" style="display: inline-block; padding: 14px 32px; background: linear-gradient(to right, #9333ea, #6b21a8); color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600;">
                            Go to Login
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Warning -->
                <tr>
                  <td style="padding: 20px 40px; background-color: #fef3c7; border-radius: 6px; margin: 20px 40px;">
                    <p style="margin: 0; font-size: 14px; color: #92400e; line-height: 1.6;">
                      <strong>Security Notice:</strong><br>
                      If you didn't make this change, please contact support immediately as your account may be compromised.
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
Password Reset Successful - SafeWebEdit

Your password has been successfully reset. You can now log in to your SafeWebEdit account with your new password.

Go to login: ${process.env.FRONTEND_URL}/login

Security Notice:
If you didn't make this change, please contact support immediately as your account may be compromised.

---
SafeWebEdit - WordPress Content Management Platform
This is an automated email. Please do not reply.
    `,
  };

  try {
    await sgMail.send(msg);
    console.log('[EMAIL] Password reset confirmation sent to:', email);
  } catch (error) {
    console.error('[EMAIL] Failed to send password reset confirmation:', error);
    // Don't throw error here - confirmation email is not critical
  }
}

async function sendWelcomeEmail(organization, tempPassword) {
  const loginUrl = process.env.FRONTEND_URL + "/login";
  const msg = {
    to: organization.email,
    from: process.env.SENDGRID_FROM_EMAIL || "noreply@safewebedit.com",
    subject: "🎉 Welcome to SafeWebEdit - Your Account is Ready!",
    text: "Welcome! Login: " + loginUrl + " Email: " + organization.email + " Temp Password: " + tempPassword
  };
  try {
    await sgMail.send(msg);
    console.log("[EMAIL] Welcome email sent to:", organization.email);
  } catch (error) {
    console.error("[EMAIL] Failed to send welcome email:", error);
    throw new Error("Failed to send welcome email");
  }
}

/**
 * Send password setup email with setup link (NearMeCalls pattern)
 * @param {object} organization - Organization object
 * @param {string} setupToken - Password setup token
 */
async function sendPasswordSetupEmail(organization, setupToken) {
  const setupUrl = `${process.env.FRONTEND_URL}/setup-password?token=${setupToken}`;
  const loginUrl = process.env.FRONTEND_URL + "/login";
  const dashboardUrl = process.env.FRONTEND_URL + "/dashboard";

  const msg = {
    to: organization.email,
    from: process.env.SENDGRID_FROM_EMAIL || "noreply@safewebedit.com",
    subject: "🎉 Welcome to SafeWebEdit - Click Here to Create Your Password",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to SafeWebEdit</title>
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

                <!-- Success Icon -->
                <tr>
                  <td align="center" style="padding: 20px;">
                    <div style="width: 64px; height: 64px; background-color: #10b981; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                      <span style="color: white; font-size: 32px;">✓</span>
                    </div>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 20px 40px;">
                    <h2 style="margin: 0 0 20px; font-size: 24px; color: #111827; text-align: center;">Welcome to SafeWebEdit!</h2>
                    <p style="margin: 0 0 20px; font-size: 16px; color: #4b5563; line-height: 1.6;">
                      Hi <strong>${organization.name}</strong>,
                    </p>
                    <p style="margin: 0 0 20px; font-size: 16px; color: #4b5563; line-height: 1.6;">
                      Your payment was successful and your account has been activated! 🎉
                    </p>
                    <p style="margin: 0 0 20px; font-size: 16px; color: #4b5563; line-height: 1.6;">
                      To get started, please set up your password by clicking the button below:
                    </p>

                    <!-- Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                      <tr>
                        <td align="center">
                          <a href="${setupUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(to right, #9333ea, #6b21a8); color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600;">
                            Click Here to Create Your Password
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin: 20px 0; font-size: 14px; color: #6b7280; line-height: 1.6;">
                      Or copy and paste this link into your browser:
                    </p>
                    <p style="margin: 0 0 20px; font-size: 14px; color: #9333ea; word-break: break-all;">
                      ${setupUrl}
                    </p>

                    <p style="margin: 20px 0; font-size: 14px; color: #6b7280; line-height: 1.6;">
                      This link will expire in <strong>48 hours</strong>.
                    </p>
                  </td>
                </tr>

                <!-- Next Steps -->
                <tr>
                  <td style="padding: 20px 40px; background-color: #f3f4f6; border-radius: 6px; margin: 20px 40px;">
                    <h3 style="margin: 0 0 15px; font-size: 18px; color: #111827;">What's Next?</h3>
                    <ol style="margin: 0; padding-left: 20px; color: #4b5563; line-height: 1.8;">
                      <li>Click the button above to set your password</li>
                      <li>Log in to your dashboard at <a href="${loginUrl}" style="color: #9333ea;">${loginUrl}</a></li>
                      <li>Connect your website and start managing content!</li>
                    </ol>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
                    <p style="margin: 0; font-size: 14px; color: #9ca3af;">
                      SafeWebEdit - AI-Powered Website Content Management
                    </p>
                    <p style="margin: 10px 0 0; font-size: 12px; color: #9ca3af;">
                      Need help? Contact us at support@safewebedit.com
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
Welcome to SafeWebEdit!

Hi ${organization.name},

Your payment was successful and your account has been activated! 🎉

To get started, please set up your password by visiting:
${setupUrl}

This link will expire in 48 hours.

What's Next?
1. Visit the link above to set your password
2. Log in to your dashboard at ${loginUrl}
3. Connect your website and start managing content!

---
SafeWebEdit - AI-Powered Website Content Management
Need help? Contact us at support@safewebedit.com
This is an automated email. Please do not reply.
    `,
  };

  try {
    await sgMail.send(msg);
    console.log("[EMAIL] Password setup email sent to:", organization.email);
    
    // Send admin notification
    const adminMsg = {
      to: "mtaahoperators@gmail.com",
      from: process.env.SENDGRID_FROM_EMAIL || "noreply@safewebedit.com",
      subject: "New Customer: " + organization.name,
      text: "New customer onboarded at SafeWebEdit\n\nBusiness: " + organization.name + "\nEmail: " + organization.email + "\nWebsite: " + (organization.website_url || "N/A") + "\nOrg ID: " + organization.id
    };    await sgMail.send(adminMsg);
    console.log("[EMAIL] Admin notification sent");

  } catch (error) {
    console.error("[EMAIL] Failed to send password setup email:", error);
    throw new Error("Failed to send password setup email");
  }
}

module.exports = {
  sendPasswordSetupEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmation,
};
