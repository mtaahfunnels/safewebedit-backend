/**
 * SendGrid Inbound Parse Webhook - SafeWebEdit
 * Receives incoming emails and generates AI responses
 *
 * EXACT CLONE of NearMeCalls email automation
 */

const express = require('express');
const router = express.Router();
const db = require('../../services/database');
const multer = require('multer');

// Multer for parsing multipart/form-data from SendGrid
const upload = multer();

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const sgMail = require('@sendgrid/mail');

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

/**
 * POST /api/email/incoming
 * SendGrid Inbound Parse webhook endpoint
 */
router.post('/incoming', upload.none(), async (req, res) => {
  try {
    // Extract email data from SendGrid Inbound Parse
    const from = req.body.from || '';
    const to = req.body.to || '';
    const subject = req.body.subject || '';
    const text = req.body.text || '';
    const html = req.body.html || '';

    // Extract email addresses
    const fromEmailMatch = from.match(/<(.+?)>/) || from.match(/([^\s]+@[^\s]+)/);
    const fromEmail = fromEmailMatch ? fromEmailMatch[1] : from;

    const toEmailMatch = to.match(/<(.+?)>/) || to.match(/([^\s]+@[^\s]+)/);
    const toEmail = toEmailMatch ? toEmailMatch[1] : to;

    console.log('[Email Incoming]', {
      from: fromEmail,
      to: toEmail,
      subject: subject.substring(0, 50)
    });

    if (!fromEmail || !text) {
      return res.status(400).json({ error: 'Missing email data' });
    }

    // Find organization by support email
    // Assumes support@safewebedit.com maps to platform
    // For multi-tenant: support@{org-slug}.safewebedit.com
    const orgResult = await db.query(
      `SELECT id, name, email FROM organizations
       WHERE email = $1 OR id::text = $2
       LIMIT 1`,
      [toEmail, extractOrgFromEmail(toEmail)]
    );

    if (orgResult.rows.length === 0) {
      console.log('[Email Incoming] No organization found for:', toEmail);
      return res.json({ success: true, message: 'No action taken' });
    }

    const organization = orgResult.rows[0];
    const organizationId = organization.id;

    // Extract thread ID
    const threadId = extractThreadId(subject, fromEmail);

    // Find or create conversation
    let conversation = await db.query(
      `SELECT id, status FROM email_conversations
       WHERE thread_id = $1 AND organization_id = $2`,
      [threadId, organizationId]
    );

    let conversationId;

    if (conversation.rows.length === 0) {
      // Create new conversation
      const newConv = await db.query(
        `INSERT INTO email_conversations (
          organization_id, customer_email, thread_id, subject, status, last_message_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id`,
        [organizationId, fromEmail, threadId, subject, 'active']
      );
      conversationId = newConv.rows[0].id;
    } else {
      conversationId = conversation.rows[0].id;

      // Update conversation
      await db.query(
        `UPDATE email_conversations
         SET last_message_at = NOW()
         WHERE id = $1`,
        [conversationId]
      );
    }

    // Save incoming message
    await db.query(
      `INSERT INTO email_messages (
        conversation_id, direction, from_email, to_email, subject, body, html_body
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [conversationId, 'inbound', fromEmail, toEmail, subject, text, html]
    );

    // Generate AI response
    const aiResponse = await generateAIEmailResponse({
      customerMessage: text,
      subject,
      conversationId,
      organizationId,
      organizationName: organization.name,
      websiteUrl: null
    });

    if (!aiResponse) {
      console.error('[Email Incoming] Failed to generate AI response');
      return res.json({ success: true, message: 'No AI response generated' });
    }

    // Send AI response email
    await sendAIResponse({
      to: fromEmail,
      from: toEmail,
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      text: aiResponse.text,
      html: aiResponse.html,
      conversationId
    });

    return res.json({ success: true });

  } catch (error) {
    console.error('[Email Incoming] Error:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Extract organization ID from support email
 * support@safewebedit.com -> null (platform)
 * support@org-123.safewebedit.com -> org-123
 */
function extractOrgFromEmail(email) {
  const match = email.match(/support@([a-f0-9-]+)\.safewebedit\.com/);
  return match ? match[1] : null;
}

/**
 * Extract thread ID from email subject and sender
 */
function extractThreadId(subject, fromEmail) {
  // Remove "Re:", "Fwd:", etc and normalize
  const normalized = subject
    .replace(/^(Re|RE|Fwd|FWD):\s*/gi, '')
    .trim()
    .toLowerCase();

  // Combine subject + email for unique thread
  return `${fromEmail.toLowerCase()}-${normalized}`.substring(0, 255);
}

/**
 * Generate AI email response using Groq
 */
async function generateAIEmailResponse(params) {
  try {
    if (!GROQ_API_KEY) {
      console.error('[AI Email] GROQ_API_KEY not configured');
      return null;
    }

    // Get conversation history
    const history = await db.query(
      `SELECT direction, body FROM email_messages
       WHERE conversation_id = $1
       ORDER BY sent_at ASC
       LIMIT 10`,
      [params.conversationId]
    );

    const conversationHistory = history.rows
      .map(msg => `${msg.direction === 'inbound' ? 'Customer' : 'You'}: ${msg.body}`)
      .join('\n\n');

    // Build system prompt
    const systemPrompt = `You are a helpful email assistant for ${params.organizationName}, a website editing service.

Your role:
- Answer questions about SafeWebEdit's WordPress editing services
- Explain how our AI-powered website updates work
- Help with account and billing questions
- Be professional, friendly, and concise

Business Info:
- Service: AI-Powered WordPress Content Updates
- Website: ${params.websiteUrl || 'safewebedit.com'}

IMPORTANT RULES:
- Keep responses under 150 words
- For technical setup questions, offer to schedule a demo call
- For billing, reference their account dashboard at safewebedit.com/dashboard
- If question is too complex, suggest logging in or contacting support@safewebedit.com
- Always sign off with "SafeWebEdit Team"`;

    const userPrompt = `${conversationHistory ? `Previous conversation:\n${conversationHistory}\n\n` : ''}New customer message:\n${params.customerMessage}\n\nGenerate a helpful response:`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      console.error('[AI Email] Groq error:', response.status);
      return null;
    }

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content?.trim();

    if (!aiText) {
      return null;
    }

    // Convert to HTML
    const html = aiText
      .split('\n\n')
      .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
      .join('');

    return {
      text: aiText,
      html
    };

  } catch (error) {
    console.error('[AI Email] Error generating response:', error.message);
    return null;
  }
}

/**
 * Send AI-generated response email
 */
async function sendAIResponse(params) {
  try {
    const msg = {
      to: params.to,
      from: params.from,
      subject: params.subject,
      text: params.text,
      html: params.html,
      trackingSettings: {
        clickTracking: { enable: false },
        openTracking: { enable: true }
      }
    };

    await sgMail.send(msg);

    // Save outbound message
    await db.query(
      `INSERT INTO email_messages (
        conversation_id, direction, from_email, to_email, subject, body, html_body
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.conversationId,
        'outbound',
        params.from,
        params.to,
        params.subject,
        params.text,
        params.html
      ]
    );

    console.log(`[AI Email] ✓ Response sent to ${params.to}`);
    return true;

  } catch (error) {
    console.error('[AI Email] Failed to send:', error.message);
    return false;
  }
}

module.exports = router;
