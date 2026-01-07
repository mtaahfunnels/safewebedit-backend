const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function checkRealmConfig() {
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

    console.log('Checking Realm Configuration for Authentication Issues...\n');

    // Get full realm configuration
    const realm = await kcAdminClient.realms.findOne({ realm: 'safewebedit' });
    
    console.log('Relevant Realm Settings:');
    console.log('  Registration Email as Username:', realm.registrationEmailAsUsername);
    console.log('  Edit Username Allowed:', realm.editUsernameAllowed);
    console.log('  Verify Email:', realm.verifyEmail);
    console.log('  Login with Email Allowed:', realm.loginWithEmailAllowed);
    console.log('  Duplicate Emails Allowed:', realm.duplicateEmailsAllowed);
    console.log('  Reset Password Allowed:', realm.resetPasswordAllowed);
    console.log('  Remember Me:', realm.rememberMe);
    console.log('  Revoke Refresh Token:', realm.revokeRefreshToken);
    console.log('  Refresh Token Max Reuse:', realm.refreshTokenMaxReuse);
    console.log('  SSO Session Idle Timeout:', realm.ssoSessionIdleTimeout);
    console.log('  SSO Session Max Lifespan:', realm.ssoSessionMaxLifespan);
    console.log('  Offline Session Idle Timeout:', realm.offlineSessionIdleTimeout);
    console.log('  Access Token Lifespan:', realm.accessTokenLifespan);

    // Check default required actions
    console.log('\nDefault Required Actions:');
    const requiredActions = await kcAdminClient.authenticationManagement.getRequiredActions();
    requiredActions.forEach(action => {
      if (action.defaultAction) {
        console.log('  - ', action.alias, '(Priority:', action.priority + ')');
      }
    });

    // Check client scopes
    console.log('\nClient Scopes:');
    const clientScopes = await kcAdminClient.clientScopes.find();
    console.log('  Total scopes:', clientScopes.length);

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response && error.response.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

checkRealmConfig();
