require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('./src/services/database');
const crypto = require('crypto');
const emailService = require('./src/services/emailService');
const { execSync } = require('child_process');

const sessionId = 'cs_test_b1ZjsnhZX3tjlHo1UQf4o5jSzqPmgnBeFBSG9Wn01lRa5vkH5x4Y6IDv4V';

async function processCheckout() {
  try {
    console.log('[Manual Trigger] Retrieving session from Stripe...');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    console.log('[Manual Trigger] Session status:', session.payment_status);
    console.log('[Manual Trigger] Customer ID:', session.customer);
    console.log('[Manual Trigger] Subscription ID:', session.subscription);
    
    const organizationId = session.client_reference_id || session.metadata.organization_id;
    console.log('[Manual Trigger] Organization ID:', organizationId);
    
    // Get organization
    const orgResult = await db.query('SELECT * FROM organizations WHERE id = $1', [organizationId]);
    const organization = orgResult.rows[0];
    
    console.log('[Manual Trigger] Organization:', organization.email);
    
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
    
    console.log('[Manual Trigger] Organization updated');
    
    // Update subscription
    await db.query(
      ,
      ["pro", session.subscription, "active", organizationId]
    );
    await db.query(
      ,
      ["pro", session.subscription, "active", organizationId]
    );
    await db.query(
      ,
      ["pro", session.subscription, "active", organizationId]
    );
    await db.query(
      ,
      ["pro", session.subscription, "active", organizationId]
    );
    await db.query(
      ,
      ["pro", session.subscription, "active", organizationId]
    );
    await db.query(
      ,
      ["pro", session.subscription, "active", organizationId]
    );
       WHERE organization_id = $5`,
      ['pro', session.subscription, session.customer, 'active', organizationId]
    );
    
    console.log('[Manual Trigger] Subscription updated');
    
    // Generate password setup token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
    
    await db.query(
      `INSERT INTO password_reset_tokens (organization_id, token, expires_at, used)
       VALUES ($1, $2, $3, false)`,
      [organizationId, token, expiresAt]
    );
    
    console.log('[Manual Trigger] Password setup token created:', token.substring(0, 10) + '...');
    
    // Create Keycloak user
    const randomPassword = crypto.randomBytes(16).toString('hex');
    
    try {
      const tokenCmd = `docker exec safewebedit-keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password admin 2>&1 | grep -v Logging into`;
      execSync(tokenCmd, { stdio: 'pipe' });
      
      const createUserCmd = `docker exec safewebedit-keycloak /opt/keycloak/bin/kcadm.sh create users -r safewebedit -s username=${organization.email} -s email=${organization.email} -s enabled=true -s emailVerified=true 2>&1`;
      const output = execSync(createUserCmd, { encoding: 'utf8', stdio: 'pipe' });
      
      const userIdMatch = output.match(/id '([^']+)'/);
      const keycloakUserId = userIdMatch ? userIdMatch[1] : null;
      
      if (keycloakUserId) {
        const setPasswordCmd = `docker exec safewebedit-keycloak /opt/keycloak/bin/kcadm.sh set-password -r safewebedit --username ${organization.email} --new-password ${randomPassword}`;
        execSync(setPasswordCmd, { stdio: 'pipe' });
        
        await db.query('UPDATE organizations SET keycloak_id = $1 WHERE id = $2', [keycloakUserId, organization.id]);
        console.log('[Manual Trigger] Keycloak user created:', keycloakUserId);
      }
    } catch (err) {
      console.error('[Manual Trigger] Keycloak error (may already exist):', err.message);
    }
    
    // Send password setup email
    await emailService.sendPasswordSetupEmail(organization, token);
    
    console.log('[Manual Trigger] ✓ Complete! Email sent to:', organization.email);
    process.exit(0);
    
  } catch (error) {
    console.error('[Manual Trigger] Error:', error);
    process.exit(1);
  }
}

processCheckout();
