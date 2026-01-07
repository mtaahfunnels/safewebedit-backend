const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function createTestUser() {
  try {
    const kcAdminClient = new KcAdminClient({
      baseUrl: 'http://localhost:8081/safewebedit-auth',
      realmName: 'master',
    });

    await kcAdminClient.auth({
      username: 'admin',
      password: 'SafeWebEditAdmin2026!',
      grantType: 'password',
      clientId: 'admin-cli',
    });

    kcAdminClient.setConfig({ realmName: 'safewebedit' });

    const testUsername = 'testuser-' + Date.now();
    const testPassword = 'dfdffdfdfd*';

    console.log('[1/3] Creating test user:', testUsername);
    
    const createdUser = await kcAdminClient.users.create({
      username: testUsername,
      email: testUsername + '@test.com',
      enabled: true,
      emailVerified: true,
      requiredActions: []
    });

    console.log('  ✓ User created, ID:', createdUser.id);

    console.log('[2/3] Setting password...');
    await kcAdminClient.users.resetPassword({
      id: createdUser.id,
      credential: {
        temporary: false,
        type: 'password',
        value: testPassword
      }
    });
    console.log('  ✓ Password set');

    console.log('[3/3] Testing authentication...');
    const fetch = require('node-fetch');
    const response = await fetch(
      'http://localhost:8081/safewebedit-auth/realms/safewebedit/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'safewebedit-dashboard',
          client_secret: 'zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT',
          grant_type: 'password',
          username: testUsername,
          password: testPassword,
        }),
      }
    );

    const data = await response.json();

    if (data.access_token) {
      console.log('\n✅ SUCCESS! Test user can authenticate!');
      console.log('   This means the system works - the issue is specific to the original user');
      
      // Clean up
      await kcAdminClient.users.del({ id: createdUser.id });
      console.log('   (Test user deleted)');
    } else {
      console.log('\n❌ FAILED! Test user also cannot authenticate');
      console.log('   Error:', data.error);
      console.log('   Description:', data.error_description);
      console.log('   This means there is a system-wide issue');
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response && error.response.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

createTestUser();
