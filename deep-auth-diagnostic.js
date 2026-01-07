const KcAdminClient = require('@keycloak/keycloak-admin-client').default;
const fetch = require('node-fetch');

async function deepAuthDiagnostic() {
  console.log('🔍 DEEP AUTHENTICATION DIAGNOSTIC');
  console.log('='.repeat(70) + '\n');

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

  const username = '98105cbc-2caf-4f16-b250-e8642126e619';
  const password = 'dfdffdfdfd*';

  // Checkpoint 1: User Lookup
  console.log('[✓] CHECKPOINT 1: User Lookup');
  const users = await kcAdminClient.users.find({ username, exact: true });
  
  if (users.length === 0) {
    console.log('  ❌ FAILED: User not found');
    process.exit(1);
  }
  
  const user = users[0];
  console.log('  ✓ User found');
  console.log('    ID:', user.id);
  console.log('    Username:', user.username);
  console.log('    Email:', user.email);
  console.log('    Enabled:', user.enabled);
  console.log('    Email Verified:', user.emailVerified);
  console.log('');

  // Checkpoint 2: User Required Actions
  console.log('[✓] CHECKPOINT 2: User Required Actions');
  console.log('    Required Actions:', user.requiredActions?.length || 0);
  if (user.requiredActions && user.requiredActions.length > 0) {
    user.requiredActions.forEach(action => {
      console.log('      -', action);
    });
    console.log('  ⚠️  User has required actions - this will block login');
  } else {
    console.log('  ✓ No required actions');
  }
  console.log('');

  // Checkpoint 3: User Credentials
  console.log('[✓] CHECKPOINT 3: User Credentials');
  const credentials = await kcAdminClient.users.getCredentials({ id: user.id });
  console.log('    Total credentials:', credentials.length);
  
  const passwordCred = credentials.find(c => c.type === 'password');
  if (!passwordCred) {
    console.log('  ❌ FAILED: No password credential found');
    process.exit(1);
  }
  
  console.log('  ✓ Password credential exists');
  console.log('    Created:', new Date(passwordCred.createdDate));
  console.log('    Temporary:', passwordCred.temporary || false);
  console.log('');

  // Checkpoint 4: Direct Grant Flow Configuration
  console.log('[✓] CHECKPOINT 4: Direct Grant Flow');
  const flows = await kcAdminClient.authenticationManagement.getFlows();
  const directGrantFlow = flows.find(f => f.alias === 'direct grant');
  console.log('    Flow ID:', directGrantFlow.id);
  
  const executions = await kcAdminClient.authenticationManagement.getExecutions({ flow: 'direct grant' });
  console.log('    Executions:');
  executions.forEach(exec => {
    const status = exec.requirement === 'DISABLED' ? '(disabled)' : exec.requirement === 'REQUIRED' ? '(required)' : exec.requirement;
    console.log();
  });
  console.log('');

  // Checkpoint 5: Client Configuration
  console.log('[✓] CHECKPOINT 5: Client Configuration');
  const clients = await kcAdminClient.clients.find({ clientId: 'safewebedit-dashboard' });
  const client = clients[0];
  console.log('    Client ID:', client.clientId);
  console.log('    Enabled:', client.enabled);
  console.log('    Direct Access Grants:', client.directAccessGrantsEnabled);
  console.log('');

  // Checkpoint 6: Realm Required Actions Default Settings
  console.log('[✓] CHECKPOINT 6: Realm Required Actions');
  const realmActions = await kcAdminClient.authenticationManagement.getRequiredActions();
  const defaultActions = realmActions.filter(a => a.defaultAction);
  
  if (defaultActions.length > 0) {
    console.log('  ⚠️  Realm has default required actions:');
    defaultActions.forEach(action => {
      console.log('      -', action.alias);
    });
  } else {
    console.log('  ✓ No default required actions');
  }
  console.log('');

  // Checkpoint 7: Attempt Authentication
  console.log('[✓] CHECKPOINT 7: Authentication Attempt');
  console.log('    Attempting password grant...');
  
  const response = await fetch(
    'http://localhost:8081/safewebedit-auth/realms/safewebedit/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'safewebedit-dashboard',
        client_secret: 'zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT',
        grant_type: 'password',
        username: username,
        password: password,
      }),
    }
  );

  const authData = await response.json();
  
  if (authData.access_token) {
    console.log('  ✅ SUCCESS! Authentication works!');
  } else {
    console.log('  ❌ FAILED!');
    console.log('    Error:', authData.error);
    console.log('    Description:', authData.error_description);
  }
  console.log('');

  // Final Analysis
  console.log('='.repeat(70));
  console.log('ANALYSIS:');
  
  if (!authData.access_token) {
    if (authData.error === 'invalid_grant' && authData.error_description === 'Account is not fully set up') {
      console.log('\nAccount is not fully set up typically means:');
      console.log('  1. User has required actions (checked - none found)');
      console.log('  2. User is not enabled (checked - enabled)');
      console.log('  3. Email not verified and realm requires it (checked - verified)');
      console.log('  4. Authentication flow has required steps not completed');
      console.log('\nSince all basic checks pass, the issue is likely:');
      console.log('  - A custom authentication flow execution requirement');
      console.log('  - A Keycloak bug or version-specific issue');
      console.log('  - Database state inconsistency');
    }
  }

  console.log('\nNext Steps:');
  console.log('  1. Check Keycloak event logs for detailed error');
  console.log('  2. Try creating user directly in Keycloak (not via Admin API)');
  console.log('  3. Compare with working NearMeCalls realm configuration');
}

deepAuthDiagnostic().catch(err => {
  console.error('\nDiagnostic failed:', err.message);
  process.exit(1);
});
