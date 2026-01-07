const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function checkAuthFlows() {
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

    console.log('Checking Realm Configuration...');
    
    // Get realm settings
    const realm = await kcAdminClient.realms.findOne({ realm: 'safewebedit' });
    console.log('\nRealm Authentication Settings:');
    console.log('  Direct Grant Flow:', realm.directGrantFlow || 'direct grant');
    
    // Get authentication flows
    const flows = await kcAdminClient.authenticationManagement.getFlows();
    console.log('\nAuthentication Flows:');
    flows.forEach(flow => {
      if (flow.alias === realm.directGrantFlow || flow.alias === 'direct grant') {
        console.log();
        console.log('    Built-in:', flow.builtIn);
        console.log('    Provider ID:', flow.providerId);
      }
    });

    // Get required actions configured at realm level
    const requiredActions = await kcAdminClient.authenticationManagement.getRequiredActions();
    console.log('\nRealm Required Actions:');
    requiredActions.forEach(action => {
      if (action.enabled || action.defaultAction) {
        console.log();
        console.log('    Enabled:', action.enabled);
        console.log('    Default Action:', action.defaultAction);
        console.log('    Priority:', action.priority);
      }
    });

    // Check user-specific required actions again
    const userId = '32b3f73c-ec33-483e-a186-a0c91ada7f14';
    const user = await kcAdminClient.users.findOne({ id: userId });
    console.log('\nUser Required Actions:');
    console.log('  User ID:', user.id);
    console.log('  Username:', user.username);
    console.log('  Email Verified:', user.emailVerified);
    console.log('  Enabled:', user.enabled);
    console.log('  Required Actions:', user.requiredActions || []);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkAuthFlows();
