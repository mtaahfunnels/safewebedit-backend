const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function checkDirectGrantFlow() {
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

    // Get all flows
    const flows = await kcAdminClient.authenticationManagement.getFlows();
    
    // Find direct grant flow
    const directGrantFlow = flows.find(f => f.alias === 'direct grant');
    
    if (!directGrantFlow) {
      console.log('Direct grant flow not found!');
      process.exit(1);
    }

    console.log('Direct Grant Flow:', directGrantFlow.alias);
    console.log('Flow ID:', directGrantFlow.id);
    console.log('\nAuthentication Executions:');
    
    // Get executions for this flow
    const executions = await kcAdminClient.authenticationManagement.getExecutions({ flow: directGrantFlow.alias });
    
    executions.forEach((exec, index) => {
      console.log('\nExecution', index + 1);
      console.log('  Display Name:', exec.displayName || exec.providerId);
      console.log('  Provider ID:', exec.providerId);
      console.log('  Requirement:', exec.requirement);
      console.log('  Configurable:', exec.configurable);
      console.log('  Level:', exec.level);
      console.log('  Index:', exec.index);
      console.log('  Authentication Config:', exec.authenticationConfig);
    });

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response && error.response.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

checkDirectGrantFlow();
