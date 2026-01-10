const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const creditService = require('../../services/creditService');

/**
 * Simple conversion: $1 = 5 credits
 * - $10 = 50 credits (50 text edits or 25 image swaps or 5 AI images)
 * - $20 = 100 credits
 * - $50 = 250 credits
 */
const CREDITS_PER_DOLLAR = 5;

/**
 * GET /api/credits/packages
 * Get available credit packages (simplified)
 */
router.get('/packages', (req, res) => {
  res.json({
    success: true,
    credits_per_dollar: CREDITS_PER_DOLLAR,
    quick_amounts: [10, 20, 50],
    pricing: {
      text_edit: 1,
      image_swap: 2,
      ai_image: 10
    }
  });
});

/**
 * GET /api/credits/balance
 * Get user's credit balance
 */
router.get('/balance', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        error: 'user_id required'
      });
    }

    const balance = await creditService.getBalance(user_id);
    const history = await creditService.getTransactionHistory(user_id, 10);

    res.json({
      success: true,
      balance: balance,
      balance_usd: (balance / CREDITS_PER_DOLLAR).toFixed(2),
      recent_transactions: history
    });

  } catch (error) {
    console.error('[CREDITS] Balance fetch error:', error.message);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * POST /api/credits/purchase
 * Create Stripe Checkout session for credit purchase
 * Accepts simple dollar amount
 */
router.post('/purchase', async (req, res) => {
  try {
    const { amount_usd, user_id, return_url } = req.body;

    // Support legacy package_id format for backwards compatibility
    let dollarAmount = amount_usd;
    if (!dollarAmount && req.body.package_id) {
      // Extract amount from package_id like "custom-10" or "custom-20"
      const match = req.body.package_id.match(/custom-(\d+)/);
      if (match) {
        dollarAmount = parseInt(match[1]);
      }
    }

    if (!dollarAmount || !user_id) {
      return res.status(400).json({
        error: 'amount_usd and user_id required'
      });
    }

    // Validate amount
    if (dollarAmount < 5 || dollarAmount > 1000) {
      return res.status(400).json({
        error: 'Amount must be between $5 and $1000'
      });
    }

    const credits = dollarAmount * CREDITS_PER_DOLLAR;

    console.log('[CREDITS] Creating checkout session:', {
      user_id,
      amount_usd: dollarAmount,
      credits: credits
    });

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${credits} SafeWebEdit Credits`,
              description: `$${dollarAmount} = ${credits} credits`,
              images: ['https://safewebedit.com/images/credits-icon.png']
            },
            unit_amount: dollarAmount * 100 // Convert to cents
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: return_url || `${process.env.FRONTEND_URL}/dashboard/credits?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: return_url || `${process.env.FRONTEND_URL}/dashboard/credits?canceled=true`,
      client_reference_id: user_id,
      metadata: {
        user_id: user_id,
        credits: credits.toString(),
        amount_usd: dollarAmount.toString()
      }
    });

    console.log('[CREDITS] Checkout session created:', session.id);

    res.json({
      success: true,
      checkout_url: session.url,
      session_id: session.id,
      amount_usd: dollarAmount,
      credits: credits
    });

  } catch (error) {
    console.error('[CREDITS] Purchase error:', error.message);
    res.status(500).json({
      error: error.message
    });
  }
});

module.exports = router;
