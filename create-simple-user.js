const KcAdminClient = require('@keycloak/keycloak-admin-client').default;
const fetch = require('node-fetch');

async function createSimpleUser() {
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

  const testUsername = 'simpleuser';
  const testPassword = 'password123';

  console.log('Creating simple test user...');
  
  // Delete if exists
  try {
    const existing = await kcAdminClient.users.find({ username: testUsername, exact: true });
    if (existing.length > 0) {
      await kcAdminClient.users.del({ id: existing[0].id });
      console.log('Deleted existing user');
    }
  } catch (e) {}

  const user = await kcAdminClient.users.create({
    username: testUsername,
    email: testUsername + '@test.com',
    enabled: true,
    emailVerified: true,
  });

  console.log('User created, ID:', user.id);

  console.log('Setting password...');
  await kcAdminClient.users.resetPassword({
    id: user.id,
    credential: {
      temporary: false,
      type: 'password',
      value: testPassword
    }
  });

  console.log('Testing authentication...');
  await new Promise(r => setTimeout(r, 2000));

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
    console.log('\n✅ SUCCESS! Simple user can login!');
    console.log('This confirms the problem is not with the authentication flow.');
    console.log('The issue is specific to UUID usernames or how the original user was created.');
  } else {
    console.log('\n❌ FAILED! Even simple user cannot login');
    console.log('Error:', data.error);
    console.log('Description:', data.error_description);
    console.log('\nThis confirms there is a fundamental problem with the SafeWebEdit realm.');
  }
}

createSimpleUser().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
