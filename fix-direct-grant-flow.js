const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function fixDirectGrantFlow() {
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

    console.log('[1/3] Getting direct grant flow...');
    const flows = await kcAdminClient.authenticationManagement.getFlows();
    const directGrantFlow = flows.find(f => f.alias === 'direct grant');
    
    if (!directGrantFlow) {
      console.error('Direct grant flow not found!');
      process.exit(1);
    }

    console.log('  Flow ID:', directGrantFlow.id);

    console.log('[2/3] Getting executions...');
    const executions = await kcAdminClient.authenticationManagement.getExecutions({ flow: 'direct grant' });
    
    console.log('  Total executions:', executions.length);

    // Find the conditional OTP execution
    const otpExecution = executions.find(e => e.displayName === 'Direct Grant - Conditional OTP');
    
    if (otpExecution) {
      console.log('[3/3] Removing Conditional OTP execution...');
      console.log('  Execution ID:', otpExecution.id);
      
      try {
        await kcAdminClient.authenticationManagement.delExecution({ id: otpExecution.id });
        console.log('  ✓ Removed Conditional OTP');
      } catch (err) {
        console.log('  ⚠️  Could not remove (might be built-in):', err.message);
        
        // Try updating to DISABLED instead
        console.log('  Attempting to disable instead...');
        await kcAdminClient.authenticationManagement.updateExecution(
          { flow: 'direct grant' },
          {
            ...otpExecution,
            requirement: 'DISABLED'
          }
        );
        console.log('  ✓ Disabled Conditional OTP');
      }
    } else {
      console.log('[3/3] No Conditional OTP found - already clean!');
    }

    console.log('\n✅ Direct grant flow configured for password-only authentication');

  } catch (error) {
    console.error('\nError:', error.message);
    if (error.response && error.response.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

fixDirectGrantFlow();
