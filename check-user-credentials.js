const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function checkUserCredentials() {
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

    const userId = '32b3f73c-ec33-483e-a186-a0c91ada7f14';
    
    // Get user details
    const user = await kcAdminClient.users.findOne({ id: userId });
    console.log('User Details:');
    console.log('  ID:', user.id);
    console.log('  Username:', user.username);
    console.log('  Email:', user.email);
    console.log('  Enabled:', user.enabled);
    console.log('  Email Verified:', user.emailVerified);
    console.log('  Required Actions:', user.requiredActions);
    console.log('  Created:', user.createdTimestamp);

    // Check credentials
    const credentials = await kcAdminClient.users.getCredentials({ id: userId });
    console.log('\nCredentials:');
    console.log('  Total credentials:', credentials.length);
    credentials.forEach((cred, index) => {
      console.log();
      console.log('    Type:', cred.type);
      console.log('    Created:', cred.createdDate);
      console.log('    Temporary:', cred.temporary);
    });

    if (credentials.length === 0) {
      console.log('\n⚠️  NO PASSWORD CREDENTIAL FOUND!');
      console.log('Setting password now...');
      
      await kcAdminClient.users.resetPassword({
        id: userId,
        credential: {
          temporary: false,
          type: 'password',
          value: 'dfdffdfdfd*'
        }
      });
      
      console.log('✓ Password set successfully');
      
      // Verify again
      const newCreds = await kcAdminClient.users.getCredentials({ id: userId });
      console.log('\nVerification - Credentials after setting:');
      console.log('  Total credentials:', newCreds.length);
    } else {
      console.log('\n✓ Password credential exists');
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkUserCredentials();
