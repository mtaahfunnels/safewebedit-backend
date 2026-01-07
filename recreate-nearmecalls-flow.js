const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function recreateNearMeCallsFlow() {
  console.log('Recreating NearMeCalls Authentication Flow in SafeWebEdit\n');

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

  console.log('[1/4] Getting direct grant flow...');
  const flows = await kcAdminClient.authenticationManagement.getFlows();
  const directGrantFlow = flows.find(f => f.alias === 'direct grant');
  console.log('  Flow ID:', directGrantFlow.id);

  console.log('[2/4] Checking current executions...');
  const executions = await kcAdminClient.authenticationManagement.getExecutions({ flow: 'direct grant' });
  console.log('  Current executions:', executions.length);
  
  executions.forEach(e => {
    const name = e.displayName || e.providerId || 'unknown';
    console.log('    -', name, '(requirement:', e.requirement + ')');
  });

  // Check if OTP sub-flow already exists
  const otpExecution = executions.find(e => e.displayName === 'Direct Grant - Conditional OTP');
  
  if (otpExecution) {
    console.log('\n[3/4] OTP sub-flow exists, updating to ALTERNATIVE...');
    await kcAdminClient.authenticationManagement.updateExecution(
      { flow: 'direct grant' },
      {
        ...otpExecution,
        requirement: 'ALTERNATIVE'
      }
    );
    console.log('  ✓ Updated to ALTERNATIVE');
  } else {
    console.log('\n[3/4] OTP sub-flow does not exist - need to create it manually via UI');
    console.log('  This requires using the Keycloak Admin Console');
  }

  console.log('\n[4/4] Final verification...');
  const finalExecs = await kcAdminClient.authenticationManagement.getExecutions({ flow: 'direct grant' });
  finalExecs.forEach((e, i) => {
    const name = e.displayName || e.providerId || 'unknown';
    console.log('  ', i + 1 + '.', name, '-', e.requirement);
  });

  console.log('\n✓ Done! Testing authentication...');
  
  // Test authentication
  const fetch = require('node-fetch');
  const response = await fetch(
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

  const data = await response.json();
  
  if (data.access_token) {
    console.log('\n✅ SUCCESS! Authentication works!');
  } else {
    console.log('\n❌ Authentication still failing:', data.error_description);
  }
}

recreateNearMeCallsFlow().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
