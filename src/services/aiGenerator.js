/**
 * AI Content Generator Service
 * Uses Groq API for AI-powered content generation with organization-aware prompts
 */

const Groq = require('groq-sdk');

class AIGenerator {
  constructor() {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
    this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  }

  /**
   * Generate content based on organization type and tone
   * @param {Object} params - Generation parameters
   * @returns {Promise<Object>} Generated content
   */
  async generateContent(params) {
    const {
      instructions,
      organization_type = 'business',
      content_tone = 'professional',
      slot_label = 'Content Section',
      current_content = null,
      max_tokens = 1000,
    } = params;

    try {
      const systemPrompt = this._buildSystemPrompt(organization_type, content_tone);
      const userPrompt = this._buildUserPrompt(instructions, slot_label, current_content);

      const startTime = Date.now();

      const completion = await this.groq.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: max_tokens,
        top_p: 1,
        stream: false,
      });

      const generationTime = Date.now() - startTime;
      const generatedContent = completion.choices[0]?.message?.content || '';

      return {
        success: true,
        content: generatedContent.trim(),
        metadata: {
          model: this.model,
          organization_type: organization_type,
          content_tone: content_tone,
          generation_time_ms: generationTime,
          tokens_used: completion.usage?.total_tokens || 0,
          prompt_tokens: completion.usage?.prompt_tokens || 0,
          completion_tokens: completion.usage?.completion_tokens || 0,
        },
      };
    } catch (error) {
      console.error('[AI] Generation error:', error);
      return {
        success: false,
        error: {
          type: error.name || 'generation_error',
          message: error.message || 'Failed to generate content',
          code: error.status || 500,
        },
      };
    }
  }

  /**
   * Build system prompt based on organization type and tone
   * @private
   */
  _buildSystemPrompt(organizationType, contentTone) {
    const basePrompt = 'You are an expert content writer for websites. Generate high-quality, engaging HTML content that is ready to be inserted into a website.';

    const typePrompts = {
      church: `You specialize in writing for churches and religious organizations. Your content should be:
- Warm, welcoming, and spiritually uplifting
- Inclusive and compassionate
- Clear and accessible to all ages
- Focused on community, faith, and service
- Use appropriate religious terminology naturally`,

      business: `You specialize in writing for businesses and professional organizations. Your content should be:
- Professional and credible
- Clear and action-oriented
- Value-focused and persuasive
- Appropriate for a business audience
- Include clear calls-to-action when relevant`,

      restaurant: `You specialize in writing for restaurants and food businesses. Your content should be:
- Appetizing and descriptive
- Warm and inviting
- Focus on food quality, ambiance, and experience
- Include sensory details
- Encourage reservations or visits`,

      realtor: `You specialize in writing for real estate professionals. Your content should be:
- Trustworthy and authoritative
- Highlight local market expertise
- Focus on value and lifestyle benefits
- Include strong calls-to-action
- Professional yet approachable`,
    };

    const tonePrompts = {
      professional: 'Maintain a professional, polished tone throughout.',
      warm: 'Use a warm, friendly, and conversational tone.',
      inspiring: 'Be inspiring and motivational while staying authentic.',
      casual: 'Use a casual, approachable tone.',
      urgent: 'Create a sense of urgency and importance.',
      educational: 'Be informative and educational in tone.',
    };

    const orgPrompt = typePrompts[organizationType] || typePrompts.business;
    const tonePrompt = tonePrompts[contentTone] || tonePrompts.professional;

    return `${basePrompt}\n\n${orgPrompt}\n\n${tonePrompt}\n\nIMPORTANT:
- Return ONLY the HTML content, no explanations
- Use semantic HTML tags (h2, h3, p, ul, li, etc.)
- Do NOT include <html>, <head>, or <body> tags
- Keep content concise and scannable
- Use proper HTML formatting and structure`;
  }

  /**
   * Build user prompt with instructions
   * @private
   */
  _buildUserPrompt(instructions, slotLabel, currentContent) {
    let prompt = `Generate HTML content for a website section called "${slotLabel}".\n\n`;
    prompt += `Instructions: ${instructions}\n\n`;

    if (currentContent && currentContent.trim().length > 0) {
      prompt += `Current content (for reference or updating):\n${currentContent}\n\n`;
      prompt += 'Update or replace the content based on the instructions above.\n\n';
    }

    prompt += 'Generate the HTML content now:';

    return prompt;
  }

  /**
   * Validate content before publishing
   * @param {string} content - HTML content to validate
   * @returns {Object} Validation result
   */
  validateContent(content) {
    if (!content || typeof content !== 'string') {
      return {
        valid: false,
        error: 'Content is required',
      };
    }

    if (content.trim().length < 10) {
      return {
        valid: false,
        error: 'Content is too short (minimum 10 characters)',
      };
    }

    if (content.length > 50000) {
      return {
        valid: false,
        error: 'Content is too long (maximum 50000 characters)',
      };
    }

    // Check for dangerous tags
    const dangerousTags = /<script|<iframe|javascript:/gi;
    if (dangerousTags.test(content)) {
      return {
        valid: false,
        error: 'Content contains potentially dangerous tags',
      };
    }

    return {
      valid: true,
      content: content,
    };
  }

  /**
   * Generate content preview (first 200 chars)
   * @param {string} content - Full content
   * @returns {string} Preview text
   */
  generatePreview(content) {
    if (!content) return '';

    // Strip HTML tags for preview
    const textOnly = content.replace(/<[^>]*>/g, ' ').trim();
    const preview = textOnly.substring(0, 200);

    return preview + (textOnly.length > 200 ? '...' : '');
  }
}

module.exports = AIGenerator;
