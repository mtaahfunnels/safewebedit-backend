require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('./src/services/database');
const crypto = require('crypto');
const emailService = require('./src/services/emailService');
const { execSync } = require('child_process');

const sessionId = 'cs_test_b1ZjsnhZX3tjlHo1UQf4o5jSzqPmgnBeFBSG9Wn01lRa5vkH5x4Y6IDv4V';

async function main() {
  try {
    console.log('✓ Retrieving session from Stripe...');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    const organizationId = session.client_reference_id || session.metadata.organization_id;
    const orgResult = await db.query('SELECT * FROM organizations WHERE id = $1', [organizationId]);
    const organization = orgResult.rows[0];
    
    console.log('✓ Organization:', organization.email);
    
    // Update organization
    await db.query(
      `UPDATE organizations
       SET stripe_customer_id = $1,
           stripe_subscription_id = $2,
           subscription_status = $3,
           is_active = $4,
           email_verified = $5
       WHERE id = $6`,
      [session.customer, session.subscription, 'active', true, true, organizationId]
    );
    
    console.log('✓ Organization activated');
    
    // Update subscription
    await db.query(
      `UPDATE subscriptions
       SET plan_name = $1,
           stripe_subscription_id = $2,
           status = $3
       WHERE organization_id = $4`,
      ['pro', session.subscription, 'active', organizationId]
    );
    
    console.log('✓ Subscription updated');
    
    // Generate password setup token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    
    await db.query(
      `INSERT INTO password_reset_tokens (organization_id, token, expires_at, used)
       VALUES ($1, $2, $3, false)`,
      [organizationId, token, expiresAt]
    );
    
    console.log('✓ Password setup token created');
    
    // Send password setup email
    await emailService.sendPasswordSetupEmail(organization, token);
    
    console.log('✓ Email sent to:', organization.email);
    console.log('✓ Setup link:', `https://safewebedit.com/setup-password?token=${token}`);
    console.log('\n✓✓✓ COMPLETE! Check email inbox.');
    process.exit(0);
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

main();
