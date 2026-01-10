/**
 * Credit Service
 * Handles all credit-related operations: checking balance, consuming credits, adding credits
 */

const { Pool } = require('pg');

class CreditService {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
  }

  /**
   * Get user credit balance
   */
  async getBalance(userId) {
    try {
      const result = await this.pool.query(
        'SELECT balance FROM user_credits WHERE user_id = $1',
        [userId]
      );
      
      // If user doesn't have a credit record, create one with 10 free credits
      if (result.rows.length === 0) {
        await this.pool.query(
          'INSERT INTO user_credits (user_id, balance) VALUES ($1, 10) ON CONFLICT (user_id) DO NOTHING',
          [userId]
        );
        return 10;
      }
      
      return result.rows[0].balance;
    } catch (error) {
      console.error('[CREDITS] Error getting balance:', error);
      throw error;
    }
  }

  /**
   * Check if user has enough credits
   */
  async hasCredits(userId, needed) {
    const balance = await this.getBalance(userId);
    return balance >= needed;
  }

  /**
   * Use credits (deduct from balance)
   */
  async useCredits(userId, amount, reason) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get current balance
      const balanceResult = await client.query(
        'SELECT balance FROM user_credits WHERE user_id = $1 FOR UPDATE',
        [userId]
      );
      
      if (balanceResult.rows.length === 0) {
        throw new Error('User credit record not found');
      }
      
      const currentBalance = balanceResult.rows[0].balance;
      
      if (currentBalance < amount) {
        throw new Error(`Insufficient credits. Need ${amount}, have ${currentBalance}`);
      }
      
      // Deduct credits
      await client.query(
        'UPDATE user_credits SET balance = balance - $1, total_consumed = total_consumed + $1, updated_at = NOW() WHERE user_id = $2',
        [amount, userId]
      );
      
      const newBalance = currentBalance - amount;
      
      // Log transaction
      await client.query(
        'INSERT INTO credit_transactions (user_id, amount, balance_after, reason) VALUES ($1, $2, $3, $4)',
        [userId, -amount, newBalance, reason]
      );
      
      await client.query('COMMIT');
      
      console.log(`[CREDITS] User ${userId} used ${amount} credits for: ${reason}. New balance: ${newBalance}`);
      
      return newBalance;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[CREDITS] Error using credits:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Add credits to user balance
   */
  async addCredits(userId, amount, reason) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Ensure user record exists
      await client.query(
        'INSERT INTO user_credits (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
        [userId]
      );
      
      // Add credits
      await client.query(
        'UPDATE user_credits SET balance = balance + $1, total_purchased = total_purchased + $1, updated_at = NOW() WHERE user_id = $2',
        [amount, userId]
      );
      
      // Get new balance
      const balanceResult = await client.query(
        'SELECT balance FROM user_credits WHERE user_id = $1',
        [userId]
      );
      
      const newBalance = balanceResult.rows[0].balance;
      
      // Log transaction
      await client.query(
        'INSERT INTO credit_transactions (user_id, amount, balance_after, reason) VALUES ($1, $2, $3, $4)',
        [userId, amount, newBalance, reason]
      );
      
      await client.query('COMMIT');
      
      console.log(`[CREDITS] User ${userId} received ${amount} credits: ${reason}. New balance: ${newBalance}`);
      
      return newBalance;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[CREDITS] Error adding credits:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get credit transaction history
   */
  async getTransactionHistory(userId, limit = 50) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userId, limit]
      );
      return result.rows;
    } catch (error) {
      console.error('[CREDITS] Error getting transaction history:', error);
      throw error;
    }
  }
}

module.exports = new CreditService();
