const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function fixKeycloakUser() {
  try {
    // Initialize Keycloak Admin Client
    const kcAdminClient = new KcAdminClient({
      baseUrl: 'http://localhost:8081/safewebedit-auth',
      realmName: 'master',
    });

    // Authenticate with admin credentials
    console.log('[Fix] Authenticating as admin...');
    await kcAdminClient.auth({
      username: 'admin',
      password: 'SafeWebEditAdmin2026!',
      grantType: 'password',
      clientId: 'admin-cli',
    });

    // Switch to safewebedit realm
    kcAdminClient.setConfig({ realmName: 'safewebedit' });

    // Find user by username (organization ID)
    const orgId = '98105cbc-2caf-4f16-b250-e8642126e619';
    console.log('[Fix] Looking up user:', orgId);
    
    const users = await kcAdminClient.users.find({ username: orgId });

    if (!users || users.length === 0) {
      console.error('[Fix] User not found!');
      process.exit(1);
    }

    const user = users[0];
    console.log('\n[Fix] User found:');
    console.log('  Keycloak ID:', user.id);
    console.log('  Username:', user.username);
    console.log('  Email:', user.email);
    console.log('  Email Verified:', user.emailVerified);
    console.log('  Enabled:', user.enabled);
    console.log('  Required Actions:', JSON.stringify(user.requiredActions || []));

    // Fix the user
    console.log('\n[Fix] Updating user to clear required actions...');
    await kcAdminClient.users.update(
      { id: user.id },
      {
        enabled: true,
        emailVerified: true,
        requiredActions: []  // Clear all required actions
      }
    );

    console.log('[Fix] ✓ User updated successfully');

    // Verify the update
    const updatedUser = await kcAdminClient.users.findOne({ id: user.id });
    console.log('\n[Fix] Verification:');
    console.log('  Email Verified:', updatedUser.emailVerified);
    console.log('  Enabled:', updatedUser.enabled);
    console.log('  Required Actions:', JSON.stringify(updatedUser.requiredActions || []));

    console.log('\n[Fix] ✓ User account is now fully set up and ready to login');

  } catch (error) {
    console.error('[Fix] Error:', error.message);
    if (error.response) {
      console.error('[Fix] Response:', error.response.data);
    }
    process.exit(1);
  }
}

fixKeycloakUser();
