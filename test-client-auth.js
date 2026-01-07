const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function testClientAuth() {
  console.log('Testing different Keycloak client configurations...\n');

  // Step 1: Enable service accounts on client
  console.log('[1/3] Enabling service accounts on client...');
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

  const clients = await kcAdminClient.clients.find({ clientId: 'safewebedit-dashboard' });
  const client = clients[0];

  await kcAdminClient.clients.update(
    { id: client.id },
    {
      ...client,
      serviceAccountsEnabled: true
    }
  );
  console.log('  ✓ Service accounts enabled');

  // Step 2: Test client_credentials grant
  console.log('\n[2/3] Testing client_credentials grant...');
  const fetch = require('node-fetch');
  
  const clientCredResponse = await fetch(
    'http://localhost:8081/safewebedit-auth/realms/safewebedit/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'safewebedit-dashboard',
        client_secret: 'zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT',
        grant_type: 'client_credentials',
      }),
    }
  );

  const clientCredData = await clientCredResponse.json();
  
  if (clientCredData.access_token) {
    console.log('  ✅ Client credentials grant WORKS');
    console.log('     This confirms the client and realm are configured correctly');
  } else {
    console.log('  ❌ Client credentials grant FAILED:',  JSON.stringify(clientCredData));
  }

  // Step 3: Try password grant one more time
  console.log('\n[3/3] Testing password grant...');
  
  const passwordResponse = await fetch(
    'http://localhost:8081/safewebedit-auth/realms/safewebedit/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'safewebedit-dashboard',
        client_secret: 'zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT',
        grant_type: 'password',
        username: '98105cbc-2caf-4f16-b250-e8642126e619',
        password: 'dfdffdfdfd*',
      }),
    }
  );

  const passwordData = await passwordResponse.json();
  
  if (passwordData.access_token) {
    console.log('  ✅ Password grant WORKS');
  } else {
    console.log('  ❌ Password grant FAILED:', passwordData.error_description || passwordData.error);
  }

  console.log('\n=== DIAGNOSIS ===');
  if (clientCredData.access_token && !passwordData.access_token) {
    console.log('Client auth works but password grant does not.');
    console.log('This suggests an issue with the direct grant authentication flow or user credentials.');
  }
}

testClientAuth().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
