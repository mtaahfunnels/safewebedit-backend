/**
 * WordPress REST API Client
 * Handles communication with WordPress sites via REST API
 * Enhanced with WooCommerce and Media Library support
 */

const axios = require('axios');

class WordPressClient {
  /**
   * Create a WordPress client instance
   * @param {string} siteUrl - WordPress site URL (e.g., https://example.com)
   * @param {string} username - WordPress username
   * @param {string} appPassword - WordPress application password
   */
  constructor(siteUrl, username, appPassword) {
    // Normalize site URL (remove trailing slash)
    this.siteUrl = siteUrl.replace(/\/$/, '');
    this.username = username;
    // Remove spaces from app password (WordPress requirement)
    this.appPassword = appPassword.replace(/\s+/g, '');

    console.log('[WP Client] Creating client with:');
    console.log('  Site URL:', this.siteUrl);
    console.log('  Username:', this.username);
    console.log('  Password (with spaces):', appPassword);
    console.log('  Password (cleaned):', this.appPassword);

    // Create base axios instance
    this.client = axios.create({
      baseURL: `${this.siteUrl}/wp-json/wp/v2`,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
      auth: {
        username: this.username,
        password: this.appPassword,
      },
    });

    // Add request interceptor for debugging
    this.client.interceptors.request.use(
      (config) => {
        console.log('[WP Client] === REQUEST INTERCEPTOR ===');
        console.log('  URL:', config.url);
        console.log('  Full URL:', config.baseURL + config.url);
        console.log('  Method:', config.method);
        console.log('  Auth:', config.auth);

        if (config.auth) {
          const token = Buffer.from(`${config.auth.username}:${config.auth.password}`).toString('base64');
          console.log('  Expected Auth Header: Basic ' + token);
        }

        console.log('  All headers:', JSON.stringify(config.headers, null, 2));
        return config;
      },
      (error) => {
        console.error('[WP Client] Request interceptor error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for debugging
    this.client.interceptors.response.use(
      (response) => {
        console.log('[WP Client] === RESPONSE SUCCESS ===');
        console.log('  Status:', response.status);
        return response;
      },
      (error) => {
        console.error('[WP Client] === RESPONSE ERROR ===');
        console.error('  Status:', error.response?.status);
        console.error('  Data:', error.response?.data);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Verify connection to WordPress site
   * @returns {Promise<Object>} Site information
   */
  async verifyConnection() {
    try {
      console.log('[WP Client] Testing authentication with /users/me');
      console.log('[WP Client] Using client with auth:', this.client.defaults.auth);

      // Test authentication by making authenticated request to users/me
      // This will verify both connectivity and credentials
      const authTest = await this.client.get('/users/me');

      console.log('[WP Client] Authentication SUCCESS!');
      console.log('[WP Client] User ID:', authTest.data.id);
      console.log('[WP Client] User Name:', authTest.data.name);

      // Try to get site info (may fail if wp-json requires auth)
      let siteInfo = {
        name: 'WordPress Site',
        description: '',
        wp_version: 'unknown'
      };

      try {
        console.log('[WP Client] Attempting to fetch site info...');
        const siteInfoResponse = await this.client.get('/', {
          baseURL: `${this.siteUrl}/wp-json`
        });
        siteInfo = siteInfoResponse.data;
        console.log('[WP Client] Site info fetched successfully');
      } catch (siteInfoError) {
        console.log('[WP Client] Could not fetch site info (not critical):', siteInfoError.message);
        // Not critical - we already verified auth works
      }

      // Check if WooCommerce is available
      let hasWooCommerce = false;
      try {
        await axios.get(`${this.siteUrl}/wp-json/wc/v3/system_status`, {
          auth: {
            username: this.username,
            password: this.appPassword,
          },
          timeout: 5000,
        });
        hasWooCommerce = true;
        console.log('[WP Client] WooCommerce detected');
      } catch (wcError) {
        console.log('[WP Client] WooCommerce not detected');
      }

      return {
        success: true,
        site_name: siteInfo.name || 'WordPress Site',
        site_description: siteInfo.description || '',
        wp_version: siteInfo.wp_version || 'unknown',
        authenticated: true,
        user_id: authTest.data.id,
        user_name: authTest.data.name,
        has_woocommerce: hasWooCommerce,
      };
    } catch (error) {
      console.error('[WP Client] ERROR in verifyConnection:');
      console.error('  Message:', error.message);
      console.error('  Response status:', error.response?.status);
      console.error('  Response data:', JSON.stringify(error.response?.data, null, 2));
      console.error('  Stack:', error.stack);

      return {
        success: false,
        error: this._parseError(error),
        site_url: this.siteUrl,
      };
    }
  }

  /**
   * Fetch all pages from WordPress
   * @param {number} perPage - Number of pages per request (max 100)
   * @returns {Promise<Array>} Array of page objects
   */
  async fetchPages(perPage = 100) {
    try {
      const pages = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await this.client.get('/pages', {
          params: {
            per_page: perPage,
            page: page,
            _fields: 'id,title,link,status,modified',
          },
        });

        pages.push(...response.data);

        // Check if there are more pages
        const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);
        hasMore = page < totalPages;
        page++;
      }

      return {
        success: true,
        pages: pages.map(p => ({
          id: p.id,
          title: p.title?.rendered || 'Untitled',
          link: p.link,
          status: p.status,
          modified: p.modified,
        })),
        total: pages.length,
      };
    } catch (error) {
      return {
        success: false,
        error: this._parseError(error),
      };
    }
  }

  /**
   * Fetch all posts from WordPress
   * @param {number} perPage - Number of posts per request (max 100)
   * @returns {Promise<Array>} Array of post objects
   */
  async fetchPosts(perPage = 100) {
    try {
      const posts = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await this.client.get('/posts', {
          params: {
            per_page: perPage,
            page: page,
            _fields: 'id,title,link,status,modified',
          },
        });

        posts.push(...response.data);

        const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);
        hasMore = page < totalPages;
        page++;
      }

      return {
        success: true,
        posts: posts.map(p => ({
          id: p.id,
          title: p.title?.rendered || 'Untitled',
          link: p.link,
          status: p.status,
          modified: p.modified,
        })),
        total: posts.length,
      };
    } catch (error) {
      return {
        success: false,
        error: this._parseError(error),
      };
    }
  }

  /**
   * Get a specific page by ID
   * @param {number} pageId - WordPress page ID
   * @returns {Promise<Object>} Page object with full content
   */
  async getPage(pageId) {
    try {
      const response = await this.client.get(`/pages/${pageId}`);
      return {
        success: true,
        page: {
          id: response.data.id,
          title: response.data.title?.rendered || 'Untitled',
          content: response.data.content?.rendered || '',
          link: response.data.link,
          status: response.data.status,
          modified: response.data.modified,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this._parseError(error),
      };
    }
  }

  /**
   * Update page content
   * @param {number} pageId - WordPress page ID
   * @param {Object} data - Update data (content, title, etc.)
   * @returns {Promise<Object>} Updated page object
   */
  async updatePage(pageId, data) {
    try {
      const response = await this.client.post(`/pages/${pageId}`, data);
      return {
        success: true,
        page: {
          id: response.data.id,
          title: response.data.title?.rendered || 'Untitled',
          content: response.data.content?.rendered || '',
          link: response.data.link,
          modified: response.data.modified,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this._parseError(error),
      };
    }
  }

  /**
   * Upload image to WordPress media library
   * @param {Buffer|ReadStream} imageData - Image file data
   * @param {string} filename - Image filename
   * @param {string} mimeType - Image MIME type (e.g., 'image/jpeg')
   * @returns {Promise<Object>} Uploaded media object
   */
  async uploadImage(imageData, filename, mimeType = 'image/jpeg') {
    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', imageData, {
        filename,
        contentType: mimeType,
      });

      const response = await axios.post(
        `${this.siteUrl}/wp-json/wp/v2/media`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Basic ${Buffer.from(`${this.username}:${this.appPassword}`).toString('base64')}`,
          },
          timeout: 30000, // 30 seconds for image upload
        }
      );

      console.log('[WP Client] Image uploaded successfully:', response.data.source_url);

      return {
        success: true,
        media: {
          id: response.data.id,
          url: response.data.source_url,
          title: response.data.title?.rendered || filename,
          alt_text: response.data.alt_text || '',
          mime_type: response.data.mime_type,
          width: response.data.media_details?.width,
          height: response.data.media_details?.height,
        },
      };
    } catch (error) {
      console.error('[WP Client] Image upload error:', error.message);
      return {
        success: false,
        error: this._parseError(error),
      };
    }
  }

  /**
   * Get media library items
   * @param {number} perPage - Number of items per request (max 100)
   * @returns {Promise<Object>} Media library items
   */
  async getMediaLibrary(perPage = 50) {
    try {
      const response = await this.client.get('/media', {
        params: {
          per_page: perPage,
          _fields: 'id,source_url,title,alt_text,mime_type,media_details',
        },
      });

      return {
        success: true,
        media: response.data.map(m => ({
          id: m.id,
          url: m.source_url,
          title: m.title?.rendered || 'Untitled',
          alt_text: m.alt_text || '',
          mime_type: m.mime_type,
          width: m.media_details?.width,
          height: m.media_details?.height,
        })),
        total: response.data.length,
      };
    } catch (error) {
      return {
        success: false,
        error: this._parseError(error),
      };
    }
  }

  /**
   * Fetch WooCommerce products
   * @param {number} perPage - Number of products per request (max 100)
   * @returns {Promise<Object>} Product list
   */
  async fetchProducts(perPage = 50) {
    try {
      const products = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await axios.get(
          `${this.siteUrl}/wp-json/wc/v3/products`,
          {
            params: {
              per_page: perPage,
              page: page,
            },
            auth: {
              username: this.username,
              password: this.appPassword,
            },
            timeout: 10000,
          }
        );

        products.push(...response.data);

        const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);
        hasMore = page < totalPages;
        page++;
      }

      console.log(`[WP Client] Fetched ${products.length} WooCommerce products`);

      return {
        success: true,
        products: products.map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          permalink: p.permalink,
          type: p.type,
          status: p.status,
          price: p.price,
          regular_price: p.regular_price,
          sale_price: p.sale_price,
          on_sale: p.on_sale,
          stock_status: p.stock_status,
          stock_quantity: p.stock_quantity,
          description: p.description,
          short_description: p.short_description,
          images: p.images?.map(img => ({
            id: img.id,
            src: img.src,
            name: img.name,
            alt: img.alt,
          })) || [],
          categories: p.categories?.map(cat => ({
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
          })) || [],
        })),
        total: products.length,
      };
    } catch (error) {
      // WooCommerce not installed or not accessible
      if (error.response?.status === 404) {
        return {
          success: false,
          error: {
            type: 'woocommerce_not_found',
            message: 'WooCommerce is not installed or REST API is not accessible',
            code: 'WOOCOMMERCE_NOT_FOUND',
          },
        };
      }
      return {
        success: false,
        error: this._parseError(error),
      };
    }
  }

  /**
   * Get a specific WooCommerce product by ID
   * @param {number} productId - WooCommerce product ID
   * @returns {Promise<Object>} Product object
   */
  async getProduct(productId) {
    try {
      const response = await axios.get(
        `${this.siteUrl}/wp-json/wc/v3/products/${productId}`,
        {
          auth: {
            username: this.username,
            password: this.appPassword,
          },
          timeout: 10000,
        }
      );

      const p = response.data;
      return {
        success: true,
        product: {
          id: p.id,
          name: p.name,
          slug: p.slug,
          permalink: p.permalink,
          type: p.type,
          status: p.status,
          price: p.price,
          regular_price: p.regular_price,
          sale_price: p.sale_price,
          on_sale: p.on_sale,
          stock_status: p.stock_status,
          stock_quantity: p.stock_quantity,
          description: p.description,
          short_description: p.short_description,
          images: p.images?.map(img => ({
            id: img.id,
            src: img.src,
            name: img.name,
            alt: img.alt,
          })) || [],
          categories: p.categories?.map(cat => ({
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
          })) || [],
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this._parseError(error),
      };
    }
  }

  /**
   * Update WooCommerce product
   * @param {number} productId - WooCommerce product ID
   * @param {Object} data - Update data (name, description, price, etc.)
   * @returns {Promise<Object>} Updated product object
   */
  async updateProduct(productId, data) {
    try {
      const response = await axios.put(
        `${this.siteUrl}/wp-json/wc/v3/products/${productId}`,
        data,
        {
          auth: {
            username: this.username,
            password: this.appPassword,
          },
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const p = response.data;
      console.log('[WP Client] Product updated successfully:', p.name);

      return {
        success: true,
        product: {
          id: p.id,
          name: p.name,
          description: p.description,
          short_description: p.short_description,
          price: p.price,
          regular_price: p.regular_price,
          sale_price: p.sale_price,
          images: p.images?.map(img => ({
            id: img.id,
            src: img.src,
            alt: img.alt,
          })) || [],
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this._parseError(error),
      };
    }
  }

  /**
   * Parse axios error into readable format
   * @private
   */
  _parseError(error) {
    if (error.response) {
      // WordPress REST API error
      return {
        type: 'api_error',
        message: error.response.data?.message || error.message,
        code: error.response.data?.code || error.response.status,
        status: error.response.status,
      };
    } else if (error.request) {
      // Network error
      return {
        type: 'network_error',
        message: 'Unable to reach WordPress site. Check the URL and network connection.',
        code: 'NETWORK_ERROR',
      };
    } else {
      // Other error
      return {
        type: 'unknown_error',
        message: error.message || 'An unknown error occurred',
        code: 'UNKNOWN_ERROR',
      };
    }
  }
}

module.exports = WordPressClient;
