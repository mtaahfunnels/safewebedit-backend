/**
 * Subscription Routes
 * Handles subscription and usage tracking
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('./auth');
const db = require('../../services/database');

// ===========================================
// GET /api/subscription
// Get subscription details for organization
// ===========================================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const subscription = await db.subscriptions.findByOrganization(req.organizationId);

    if (!subscription) {
      // Create default free subscription if none exists
      const text = `
        INSERT INTO subscriptions (organization_id, plan_name, is_unlimited, monthly_update_limit)
        VALUES ($1, 'Free', false, 10)
        ON CONFLICT (organization_id) DO NOTHING
        RETURNING *
      `;
      const result = await db.query(text, [req.organizationId]);
      
      if (result.rows.length > 0) {
        const newSub = result.rows[0];
        return res.json({
          subscription: {
            plan_name: newSub.plan_name,
            is_unlimited: newSub.is_unlimited,
            monthly_limit: newSub.monthly_update_limit,
            updates_this_month: newSub.updates_this_month || 0,
            billing_cycle_start: newSub.billing_cycle_start,
            next_billing_date: newSub.next_billing_date,
            status: 'active',
          },
        });
      }
    }

    res.json({
      subscription: {
        plan_name: subscription.plan_name,
        is_unlimited: subscription.is_unlimited,
        monthly_limit: subscription.monthly_update_limit,
        updates_this_month: subscription.updates_this_month || 0,
        billing_cycle_start: subscription.billing_cycle_start,
        next_billing_date: subscription.next_billing_date,
        status: 'active',
      },
    });
  } catch (error) {
    console.error('[SUBSCRIPTION] Get subscription error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

// ===========================================
// GET /api/subscription/usage
// Get detailed usage statistics
// ===========================================
router.get('/usage', authenticateToken, async (req, res) => {
  try {
    const usage = await db.subscriptions.getUsage(req.organizationId);

    if (!usage) {
      return res.json({
        plan_name: 'Free',
        is_unlimited: false,
        monthly_limit: 10,
        updates_this_month: 0,
        remaining: 10,
        limit_reached: false,
        usage_percentage: 0,
      });
    }

    const usagePercentage = usage.is_unlimited 
      ? 0 
      : Math.round((usage.updates_this_month / usage.monthly_limit) * 100);

    res.json({
      plan_name: usage.plan_name,
      is_unlimited: usage.is_unlimited,
      monthly_limit: usage.monthly_limit,
      updates_this_month: usage.updates_this_month,
      remaining: usage.remaining,
      limit_reached: usage.limit_reached,
      usage_percentage: usagePercentage,
    });
  } catch (error) {
    console.error('[SUBSCRIPTION] Get usage error:', error);
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

module.exports = router;
