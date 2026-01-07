const fetch = require('node-fetch');

async function testNearMeCallsAuth() {
  console.log('Testing NearMeCalls authentication (known to work)...\n');

  const response = await fetch(
    'http://localhost:8080/realms/nearmecalls/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'nearmecalls-dashboard',
        client_secret: 'd22W6MB4ruuOz1SNFteQ8lE6epZXCtoN',
        grant_type: 'password',
        username: '+12547351438',  // Known working NearMeCalls user
        password: 'wQt14nUuFITI',
      }),
    }
  );

  const data = await response.json();

  if (data.access_token) {
    console.log('✅ NearMeCalls authentication WORKS');
    console.log('   Access token received');
    console.log('\nThis confirms the issue is specific to SafeWebEdit realm configuration');
  } else {
    console.log('❌ NearMeCalls authentication also fails:');
    console.log('  ', JSON.stringify(data, null, 2));
  }
}

testNearMeCallsAuth();
