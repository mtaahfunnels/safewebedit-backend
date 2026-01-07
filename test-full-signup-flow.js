const fetch = require('node-fetch');

async function testFullSignupFlow() {
  console.log('Testing Complete Signup Flow (Stripe → Webhook → Password Setup → Login)\n');

  const testEmail = 'test-' + Date.now() + '@example.com';
  const testPassword = 'dfdffdfdfd*';

  // Step 1: Simulate Stripe webhook
  console.log('[1/5] Simulating Stripe webhook for new customer...');
  const webhookPayload = {
    type: 'customer.subscription.created',
    data: {
      object: {
        id: 'sub_test_' + Date.now(),
        customer: 'cus_test_' + Date.now(),
        status: 'active',
        plan: {
          id: 'price_basic_monthly',
          product: 'prod_safewebedit_basic'
        },
        metadata: {
          website_url: 'https://test.example.com'
        }
      }
    },
    api_version: '2023-10-16'
  };

  // Get customer from Stripe API (simulated)
  const customerData = {
    id: webhookPayload.data.object.customer,
    email: testEmail,
    name: 'Test User',
    metadata: {
      website_url: 'https://test.example.com'
    }
  };

  const webhookResponse = await fetch('http://localhost:5005/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': 'simulated'  // In real app, this would be verified
    },
    body: JSON.stringify({
      ...webhookPayload,
      _simulatedCustomer: customerData  // Helper for testing
    })
  });

  console.log('  Webhook response:', webhookResponse.status);

  // Small delay for webhook processing
  await new Promise(r => setTimeout(r, 1000));

  // Step 2: Get organization from database
  console.log('\n[2/5] Looking up created organization...');
  const db = require('./src/services/database');
  const orgResult = await db.query(
    'SELECT id, email FROM organizations WHERE email = $1',
    [testEmail]
  );

  if (orgResult.rows.length === 0) {
    console.log('  ❌ Organization not created by webhook!');
    process.exit(1);
  }

  const org = orgResult.rows[0];
  console.log('  ✓ Organization created');
  console.log('    ID:', org.id);
  console.log('    Email:', org.email);

  // Step 3: Get password setup token
  console.log('\n[3/5] Getting password setup token...');
  const tokenResult = await db.query(
    'SELECT token FROM password_reset_tokens WHERE organization_id = $1 AND used = false ORDER BY created_at DESC LIMIT 1',
    [org.id]
  );

  if (tokenResult.rows.length === 0) {
    console.log('  ❌ No setup token found!');
    process.exit(1);
  }

  const setupToken = tokenResult.rows[0].token;
  console.log('  ✓ Setup token found');

  // Step 4: Set password via setup endpoint
  console.log('\n[4/5] Setting password via setup endpoint...');
  const setupResponse = await fetch('http://localhost:5005/api/auth/setup-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: setupToken,
      password: testPassword
    })
  });

  const setupData = await setupResponse.json();
  console.log('  Response:', setupData);

  if (!setupData.success) {
    console.log('  ❌ Password setup failed!');
    process.exit(1);
  }

  console.log('  ✓ Password set successfully');

  // Step 5: Test authentication
  console.log('\n[5/5] Testing authentication...');
  await new Promise(r => setTimeout(r, 1000));  // Wait for Keycloak to sync

  const authResponse = await fetch(
    'http://localhost:8081/safewebedit-auth/realms/safewebedit/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'safewebedit-dashboard',
        client_secret: 'zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT',
        grant_type: 'password',
        username: org.id,
        password: testPassword,
      }),
    }
  );

  const authData = await authResponse.json();

  if (authData.access_token) {
    console.log('\n✅ SUCCESS! Complete signup flow works!');
    console.log('   User can sign up and login');
    console.log('   Access token received');
    
    // Cleanup
    await db.query('DELETE FROM organizations WHERE id = $1', [org.id]);
    console.log('   (Test user cleaned up)');
  } else {
    console.log('\n❌ FAILED! Authentication does not work');
    console.log('   Error:', authData.error);
    console.log('   Description:', authData.error_description);
  }
}

testFullSignupFlow().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
