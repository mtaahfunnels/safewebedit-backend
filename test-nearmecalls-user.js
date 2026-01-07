const fetch = require('node-fetch');

async function testNearMeCallsUser() {
  console.log('Testing known working NearMeCalls user authentication\n');

  const response = await fetch(
    'http://localhost:8080/auth/realms/nearmecalls/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'nearmecalls-dashboard',
        client_secret: 'd22W6MB4ruuOz1SNFteQ8lE6epZXCtoN',
        grant_type: 'password',
        username: '+12547351438',
        password: 'wQt14nUuFITI',
      }),
    }
  );

  const data = await response.json();

  if (data.access_token) {
    console.log('✅ NearMeCalls user authentication WORKS');
    console.log('   Token:', data.access_token.substring(0, 50) + '...');
    console.log('\nThis confirms NearMeCalls realm is properly configured.');
    console.log('Let me check if there are other differences...');
  } else {
    console.log('❌ NearMeCalls authentication failed:');
    console.log(JSON.stringify(data, null, 2));
  }
}

testNearMeCallsUser().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
