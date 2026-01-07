const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function copyNearMeCallsFlow() {
  const kcAdminClient = new KcAdminClient({
    baseUrl: 'http://localhost:8080',  // NearMeCalls Keycloak
    realmName: 'master',
  });

  await kcAdminClient.auth({
    username: 'admin',
    password: 'NearMeCallsAdmin2026!',
    grantType: 'password',
    clientId: 'admin-cli',
  });

  // Get NearMeCalls direct grant flow
  console.log('Getting NearMeCalls direct grant flow configuration...');
  kcAdminClient.setConfig({ realmName: 'nearmecalls' });
  
  const flows = await kcAdminClient.authenticationManagement.getFlows();
  const directGrantFlow = flows.find(f => f.alias === 'direct grant');
  
  const executions = await kcAdminClient.authenticationManagement.getExecutions({ flow: 'direct grant' });
  
  console.log('\nNearMeCalls Direct Grant Flow:');
  console.log('  Flow ID:', directGrantFlow.id);
  console.log('  Executions:');
  executions.forEach(exec => {
    console.log();
  });

  // Now apply to SafeWebEdit
  console.log('\nSwitching to SafeWebEdit realm...');
  const swAdminClient = new KcAdminClient({
    baseUrl: 'http://localhost:8081/safewebedit-auth',
    realmName: 'master',
  });

  await swAdminClient.auth({
    username: 'admin',
    password: 'SafeWebEditAdmin2026!',
    grantType: 'password',
    clientId: 'admin-cli',
  });

  swAdminClient.setConfig({ realmName: 'safewebedit' });

  const swFlows = await swAdminClient.authenticationManagement.getFlows();
  const swDirectGrant = swFlows.find(f => f.alias === 'direct grant');
  
  const swExecutions = await swAdminClient.authenticationManagement.getExecutions({ flow: 'direct grant' });
  
  console.log('\nSafeWebEdit Current Direct Grant Flow:');
  swExecutions.forEach(exec => {
    console.log();
  });

  // Copy requirement settings from NearMeCalls to SafeWebEdit
  console.log('\nApplying NearMeCalls configuration to SafeWebEdit...');
  
  for (const nmExec of executions) {
    const swExec = swExecutions.find(e => 
      (e.providerId === nmExec.providerId) ||
      (e.displayName === nmExec.displayName)
    );
    
    if (swExec && swExec.requirement !== nmExec.requirement) {
      console.log();
      
      await swAdminClient.authenticationManagement.updateExecution(
        { flow: 'direct grant' },
        {
          ...swExec,
          requirement: nmExec.requirement
        }
      );
    }
  }

  console.log('\n✓ Configuration copied from NearMeCalls to SafeWebEdit');
}

copyNearMeCallsFlow().catch(err => {
  console.error('Error:', err.message);
  if (err.response && err.response.data) {
    console.error('Response:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
