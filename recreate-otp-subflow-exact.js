const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function recreateOTPSubflow() {
  console.log('Recreating OTP Sub-flow to Match NearMeCalls Exactly\n');

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

  console.log('[1/5] Creating OTP sub-flow...');
  
  // Create the sub-flow
  const subflow = await kcAdminClient.authenticationManagement.createFlow({
    alias: 'Direct Grant - Conditional OTP',
    providerId: 'basic-flow',
    topLevel: false,
    description: 'Flow to determine if the OTP is required for the authentication'
  });
  
  console.log('  ✓ Sub-flow created');

  console.log('[2/5] Adding conditional-user-configured authenticator...');
  await kcAdminClient.authenticationManagement.addExecutionToFlow({
    flow: 'Direct Grant - Conditional OTP',
    provider: 'conditional-user-configured'
  });
  console.log('  ✓ Added');

  console.log('[3/5] Adding OTP validator...');
  await kcAdminClient.authenticationManagement.addExecutionToFlow({
    flow: 'Direct Grant - Conditional OTP',
    provider: 'direct-grant-validate-otp'
  });
  console.log('  ✓ Added');

  console.log('[4/5] Adding sub-flow to direct grant flow...');
  await kcAdminClient.authenticationManagement.addFlowToFlow({
    flow: 'direct grant',
    alias: 'Direct Grant - Conditional OTP',
    type: 'basic-flow'
  });
  console.log('  ✓ Added to direct grant');

  console.log('[5/5] Setting requirement to CONDITIONAL...');
  const executions = await kcAdminClient.authenticationManagement.getExecutions({ flow: 'direct grant' });
  const otpExecution = executions.find(e => e.displayName === 'Direct Grant - Conditional OTP');
  
  if (otpExecution) {
    await kcAdminClient.authenticationManagement.updateExecution(
      { flow: 'direct grant' },
      {
        ...otpExecution,
        requirement: 'CONDITIONAL'
      }
    );
    console.log('  ✓ Set to CONDITIONAL');
  }

  console.log('\n✅ Done! Testing authentication...');
  
  const fetch = require('node-fetch');
  await new Promise(r => setTimeout(r, 2000));  // Wait for Keycloak to sync
  
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
    console.log('\n✅✅✅ SUCCESS! AUTHENTICATION WORKS! ✅✅✅');
    console.log('Token:', data.access_token.substring(0, 50) + '...');
  } else {
    console.log('\n❌ Still failing:', data.error_description || data.error);
  }
}

recreateOTPSubflow().catch(err => {
  console.error('Error:', err.message);
  if (err.response && err.response.data) {
    console.error('Response:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
