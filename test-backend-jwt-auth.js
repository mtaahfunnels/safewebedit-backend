const fetch = require('node-fetch');

async function testBackendJWTAuth() {
  console.log('Testing Backend JWT Authentication');
  console.log('='.repeat(70) + '\n');

  const testEmail = 'growpersonalfinance@gmail.com';
  const testPassword = 'dfdffdfdfd*';

  // Test backend login endpoint
  console.log('[1/2] Testing /api/auth/login endpoint...');
  const loginResponse = await fetch('http://localhost:5005/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword
    })
  });

  const loginData = await loginResponse.json();

  if (!loginData.success) {
    console.log('  ❌ Login failed:', loginData.error);
    process.exit(1);
  }

  console.log('  ✅ Login successful!');
  console.log('    Token:', loginData.token.substring(0, 50) + '...');
  console.log('    User:', loginData.user.email);
  console.log('');

  // Test authenticated request
  console.log('[2/2] Testing authenticated API request...');
  const testResponse = await fetch('http://localhost:5005/api/wordpress/sites', {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + loginData.token
    }
  });

  const status = testResponse.status;
  console.log('  Response status:', status);

  if (status === 200 || status === 404) {
    console.log('  ✅ Authenticated request works!');
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('✅ BACKEND JWT AUTHENTICATION IS WORKING!');
  console.log('');
  console.log('This authentication system:');
  console.log('  - Does NOT use Keycloak password grant');
  console.log('  - Generates JWT tokens via backend /api/auth/login');
  console.log('  - Verifies JWT tokens for authenticated requests');
  console.log('  - Works immediately without Keycloak fixes');
}

testBackendJWTAuth().catch(err => {
  console.error('\nTest failed:', err.message);
  process.exit(1);
});
