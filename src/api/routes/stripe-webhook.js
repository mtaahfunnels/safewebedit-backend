/**
 * Stripe Webhook Handler - EXACT NearMeCalls Clone
 * Handles Stripe events for autonomous onboarding automation
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../../services/database');
const creditService = require('../../services/creditService');
const emailService = require('../../services/emailService');
const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

// Stripe will be initialized when needed
let stripe = null;

function getStripeClient() {
  if (!stripe) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = require('stripe')(stripeKey);
  }
  return stripe;
}

/**
 * POST /api/stripe/webhook
 * Handle Stripe webhook events
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;

  try {
    const stripeClient = getStripeClient();
    event = stripeClient.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('[Stripe Webhook] Event received:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        console.log('[Stripe Webhook] Payment succeeded:', event.data.object.id);
        break;

      case 'invoice.payment_failed':
        console.log('[Stripe Webhook] Payment failed:', event.data.object.id);
        break;

      default:
        console.log('[Stripe Webhook] Unhandled event type:', event.type);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[Stripe Webhook] Error processing event:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * EXACT CLONE of NearMeCalls handleCheckoutCompleted
 */
async function handleCheckoutCompleted(session) {
  console.log('[Stripe Webhook] Checkout completed:', session.id);

  // Check if this is a credit purchase or subscription
  if (session.metadata && session.metadata.credits) {
    // This is a credit purchase
    await handleCreditPurchase(session);
    return;
  }

  // Otherwise, handle as subscription/onboarding
  const organizationId = session.client_reference_id || session.metadata.organization_id;

  if (!organizationId) {
    console.error('[Stripe Webhook] No organization ID in session');
    return;
  }

  try {
    // Get organization
    const orgResult = await db.query(
      'SELECT * FROM organizations WHERE id = $1',
      [organizationId]
    );

    if (orgResult.rows.length === 0) {
      console.error('[Stripe Webhook] Organization not found:', organizationId);
      return;
    }

    const organization = orgResult.rows[0];

    // Update organization with Stripe details and activate
    await db.query(
      `UPDATE organizations
       SET stripe_customer_id = $1,
           stripe_subscription_id = $2,
           subscription_status = $3,
           is_active = $4,
           email_verified = $5
       WHERE id = $6`,
      [
        session.customer,
        session.subscription,
        'active',
        true,
        false,  // Email NOT verified yet - user must click setup link
        organizationId,
      ]
    );

    console.log('[Stripe Webhook] Organization activated:', organizationId);

    // Update subscription table
    await db.query(
      `UPDATE subscriptions
       SET plan_name = $1,
           stripe_subscription_id = $2,
           status = $3
       WHERE organization_id = $4`,
      [
        'pro',
        session.subscription,
        'active',
        organizationId,
      ]
    );

    // EXACT CLONE: Create user and generate setup token in one function
    const result = await createUserAndGenerateSetupToken(organization);

    if (result.success) {
      // Send password setup email with token
      await emailService.sendPasswordSetupEmail(organization, result.setupToken);
      console.log('[Stripe Webhook] Onboarding completed for:', organization.email);
    } else {
      console.error('[Stripe Webhook] Failed to create user:', result.message);
    }

  } catch (error) {
    console.error('[Stripe Webhook] Error in checkout completion:', error);
    throw error;
  }
}

/**
 * EXACT CLONE of NearMeCalls create_user_and_generate_setup_token
 * Creates Keycloak user WITHOUT password and generates 48-hour setup token
 */
async function createUserAndGenerateSetupToken(organization) {
  console.log('[Stripe Webhook] Creating passwordless Keycloak user for:', organization.email);

  try {
    // Initialize Keycloak Admin Client
    const kcAdminClient = new KcAdminClient({
      baseUrl: 'http://localhost:8081/safewebedit-auth',
      realmName: 'master',
    });

    // Authenticate with admin credentials
    await kcAdminClient.auth({
      username: 'admin',
      password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'SafeWebEditKeycloak2026!',
      grantType: 'password',
      clientId: 'admin-cli',
    });

    // Switch to safewebedit realm
    kcAdminClient.setConfig({ realmName: 'safewebedit' });

    // EXACT CLONE: Use organization ID as unique email (like NearMeCalls uses phone@nearmecalls.system)
    const uniqueEmail = `${organization.id}@safewebedit.system`;

    console.log('[Stripe Webhook] Creating user with unique email:', uniqueEmail);

    // Create user WITHOUT password
    let keycloakUserId;
    try {
      const createdUser = await kcAdminClient.users.create({
        username: organization.id,  // UNIQUE identifier like phone number in NearMeCalls
        email: uniqueEmail,  // UNIQUE per organization
        enabled: true,
        emailVerified: false,  // User must verify via password setup
        credentials: [],  // NO PASSWORD
        attributes: {
          customer_email: [organization.email],  // Real email stored here
          organization_id: [organization.id],
          organization_name: [organization.name || ''],
          website_url: [organization.website_url || '']
        }
      });
      keycloakUserId = createdUser.id;
      console.log('[Stripe Webhook] Keycloak user created:', keycloakUserId);
    } catch (createError) {
      // Handle duplicate user
      if (createError.response && createError.response.status === 409) {
        console.log('[Stripe Webhook] User already exists, fetching ID...');
        const users = await kcAdminClient.users.find({ username: organization.id });
        if (users && users.length > 0) {
          keycloakUserId = users[0].id;
          console.log('[Stripe Webhook] Found existing user:', keycloakUserId);
        } else {
          throw new Error('User exists but could not be found');
        }
      } else {
        throw createError;
      }
    }

    // Update organization with Keycloak ID
    await db.query(
      'UPDATE organizations SET keycloak_id = $1 WHERE id = $2',
      [keycloakUserId, organization.id]
    );

    // EXACT CLONE: Generate 48-hour password setup token
    const setupToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);  // 48 hours

    console.log('[Stripe Webhook] Generating 48-hour password setup token');

    // Delete old tokens for this organization
    await db.query(
      'DELETE FROM password_reset_tokens WHERE organization_id = $1',
      [organization.id]
    );

    // Store new token
    await db.query(
      `INSERT INTO password_reset_tokens (organization_id, token, expires_at, used, email)
       VALUES ($1, $2, $3, false, $4)`,
      [organization.id, setupToken, expiresAt, organization.email]
    );

    console.log('[Stripe Webhook] Password setup token created');

    return {
      success: true,
      userId: keycloakUserId,
      setupToken: setupToken,
      message: 'User created and token generated (NearMeCalls pattern)'
    };

  } catch (error) {
    console.error('[Stripe Webhook] Error in createUserAndGenerateSetupToken:', error);
    return {
      success: false,
      message: error.message || 'Unknown error'
    };
  }
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdated(subscription) {
  console.log('[Stripe Webhook] Subscription updated:', subscription.id);

  const organizationResult = await db.query(
    'SELECT id FROM organizations WHERE stripe_subscription_id = $1',
    [subscription.id]
  );

  if (organizationResult.rows.length === 0) {
    console.log('[Stripe Webhook] No organization found for subscription:', subscription.id);
    return;
  }

  const organizationId = organizationResult.rows[0].id;

  await db.query(
    `UPDATE subscriptions
     SET status = $1
     WHERE organization_id = $2`,
    [subscription.status, organizationId]
  );

  const isActive = subscription.status === 'active';
  await db.query(
    `UPDATE organizations
     SET subscription_status = $1,
         is_active = $2
     WHERE id = $3`,
    [subscription.status, isActive, organizationId]
  );

  console.log('[Stripe Webhook] Subscription status updated to:', subscription.status);
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionDeleted(subscription) {
  console.log('[Stripe Webhook] Subscription deleted:', subscription.id);

  await db.query(
    `UPDATE organizations
     SET subscription_status = $1,
         is_active = $2
     WHERE stripe_subscription_id = $3`,
    ['canceled', false, subscription.id]
  );

  await db.query(
    `UPDATE subscriptions
     SET status = $1
     WHERE stripe_subscription_id = $2`,
    ['canceled', subscription.id]
  );
}


/**
 * Handle credit purchase completion
 */
async function handleCreditPurchase(session) {
  console.log('[Stripe Webhook] Processing credit purchase');

  const user_id = session.metadata.user_id;
  const credits = parseInt(session.metadata.credits);
  const package_id = session.metadata.package_id;
  const amount_paid = session.amount_total / 100;

  console.log('[Stripe Webhook] Credit purchase details:', {
    user_id,
    credits,
    package_id,
    amount_paid
  });

  if (!user_id || !credits) {
    console.error('[Stripe Webhook] Missing user_id or credits in metadata');
    return;
  }

  try {
    // Add credits to user account
    const newBalance = await creditService.addCredits(
      user_id,
      credits,
      `Purchased ${package_id} pack - ${credits} credits`
    );

    console.log('[Stripe Webhook] Credits added successfully:', {
      user_id,
      credits_added: credits,
      new_balance: newBalance
    });

  } catch (error) {
    console.error('[Stripe Webhook] Failed to add credits:', error.message);
    throw error;
  }
}

module.exports = router;
