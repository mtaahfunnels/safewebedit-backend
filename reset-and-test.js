const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function resetAndTest() {
  try {
    const kcAdminClient = new KcAdminClient({
      baseUrl: 'http://localhost:8081/safewebedit-auth',
      realmName: 'master',
    });

    console.log('[1/4] Authenticating as admin...');
    await kcAdminClient.auth({
      username: 'admin',
      password: 'SafeWebEditAdmin2026!',
      grantType: 'password',
      clientId: 'admin-cli',
    });

    kcAdminClient.setConfig({ realmName: 'safewebedit' });

    const userId = '32b3f73c-ec33-483e-a186-a0c91ada7f14';
    const username = '98105cbc-2caf-4f16-b250-e8642126e619';
    const password = 'dfdffdfdfd*';

    console.log('[2/4] Resetting password...');
    await kcAdminClient.users.resetPassword({
      id: userId,
      credential: {
        temporary: false,
        type: 'password',
        value: password
      }
    });
    console.log('✓ Password reset');

    console.log('[3/4] Ensuring user is fully enabled...');
    await kcAdminClient.users.update(
      { id: userId },
      {
        enabled: true,
        emailVerified: true,
        requiredActions: []
      }
    );
    console.log('✓ User updated');

    console.log('[4/4] Testing authentication...');
    
    // Test with direct token request
    const fetch = require('node-fetch');
    const response = await fetch(
      'http://localhost:8081/safewebedit-auth/realms/safewebedit/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: 'safewebedit-dashboard',
          client_secret: 'zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT',
          grant_type: 'password',
          username: username,
          password: password,
        }),
      }
    );

    const data = await response.json();

    if (data.access_token) {
      console.log('\n✅ SUCCESS! Authentication works!');
      console.log('Access token received (first 50 chars):', data.access_token.substring(0, 50) + '...');
      console.log('Token type:', data.token_type);
      console.log('Expires in:', data.expires_in, 'seconds');
    } else {
      console.log('\n❌ FAILED!');
      console.log('Error:', data.error);
      console.log('Description:', data.error_description);
    }

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

resetAndTest();
