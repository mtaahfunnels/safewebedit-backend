const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function disableOTP() {
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

    // Get user's credentials including OTP
    const credentials = await kcAdminClient.users.getCredentials({ id: userId });
    
    console.log('User Credentials:');
    credentials.forEach(cred => {
      console.log('  Type:', cred.type);
      console.log('    ID:', cred.id);
      console.log('    Created:', new Date(cred.createdDate));
      console.log('');
    });

    // Check for OTP credentials
    const otpCreds = credentials.filter(c => c.type === 'otp');
    
    if (otpCreds.length > 0) {
      console.log('Found', otpCreds.length, 'OTP credential(s). Removing...');
      
      for (const otp of otpCreds) {
        await kcAdminClient.users.deleteCredential({
          id: userId,
          credentialId: otp.id
        });
        console.log('  ✓ Removed OTP credential:', otp.id);
      }
    } else {
      console.log('No OTP credentials found.');
    }

    // Make sure CONFIGURE_TOTP is not in required actions
    const user = await kcAdminClient.users.findOne({ id: userId });
    const requiredActions = (user.requiredActions || []).filter(a => a !== 'CONFIGURE_TOTP');
    
    if (requiredActions.length !== (user.requiredActions || []).length) {
      console.log('\nRemoving CONFIGURE_TOTP from required actions...');
      await kcAdminClient.users.update(
        { id: userId },
        { requiredActions }
      );
      console.log('✓ Removed CONFIGURE_TOTP');
    }

    console.log('\n✅ User is now ready for password-only authentication');

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response && error.response.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

disableOTP();
