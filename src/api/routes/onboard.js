/**
 * Onboarding API Routes
 * Handles new customer onboarding and Stripe checkout creation
 *
 * Pattern: Simplified onboarding - user creates account first, adds WordPress sites later
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../../services/database');

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
 * POST /api/onboard
 * Create new organization and Stripe checkout session
 */
router.post('/', async (req, res) => {
  console.log('[Onboarding] New onboarding request');

  try {
    const {
      name,
      email,
      password,
    } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, email, password',
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
      });
    }

    // Password validation
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters',
      });
    }

    // Check if email already exists
    const existingUser = await db.query(
      'SELECT id FROM organizations WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists',
      });
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    // Check if slug exists, add random suffix if needed
    let finalSlug = slug;
    let slugSuffix = 1;
    while (true) {
      const slugCheck = await db.query(
        'SELECT id FROM organizations WHERE slug = $1',
        [finalSlug]
      );
      if (slugCheck.rows.length === 0) break;
      finalSlug = `${slug}-${slugSuffix}`;
      slugSuffix++;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create organization record (pending payment for trial)
    const pendingOrgId = crypto.randomUUID();

    await db.query(
      `INSERT INTO organizations
       (id, name, slug, email, password_hash, email_verified, subscription_status, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        pendingOrgId,
        name,
        finalSlug,
        email.toLowerCase(),
        passwordHash,
        false, // Not verified yet
        'trialing', // Start with trial status
        true, // Active immediately for trial
      ]
    );

    // Store onboarding metadata
    await db.query(
      `UPDATE organizations
       SET metadata = $1
       WHERE id = $2`,
      [
        JSON.stringify({
          onboardingDate: new Date().toISOString(),
          trialStartDate: new Date().toISOString(),
          trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days
        }),
        pendingOrgId,
      ]
    );

    console.log('[Onboarding] Created trial organization:', pendingOrgId);

    // Create Stripe Checkout session for trial
    const stripeClient = getStripeClient();

    const session = await stripeClient.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, // Set in .env
          quantity: 1,
        },
      ],
      customer_email: email,
      client_reference_id: pendingOrgId, // Link to our organization
      metadata: {
        organization_id: pendingOrgId,
        name: name,
      },
      success_url: `${process.env.FRONTEND_URL}/onboard/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/onboard?canceled=true`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          organization_id: pendingOrgId,
        },
      },
    });

    console.log('[Onboarding] Stripe session created:', session.id);

    // Store Stripe session ID for tracking
    await db.query(
      `UPDATE organizations
       SET stripe_checkout_session_id = $1
       WHERE id = $2`,
      [session.id, pendingOrgId]
    );

    return res.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      organizationId: pendingOrgId,
    });

  } catch (error) {
    console.error('[Onboarding] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create onboarding session: ' + error.message,
    });
  }
});

/**
 * GET /api/onboard/session/:sessionId
 * Check status of Stripe checkout session
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    const stripeClient = getStripeClient();
    const session = await stripeClient.checkout.sessions.retrieve(req.params.sessionId);

    return res.json({
      success: true,
      status: session.status,
      payment_status: session.payment_status,
      customer_email: session.customer_email,
    });
  } catch (error) {
    console.error('[Onboarding] Session check error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
