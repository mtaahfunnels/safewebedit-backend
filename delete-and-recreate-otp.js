const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function deleteAndRecreateOTP() {
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

  // Delete existing OTP flow if it exists
  const flows = await kcAdminClient.authenticationManagement.getFlows();
  const otpFlow = flows.find(f => f.alias === 'Direct Grant - Conditional OTP');
  
  if (otpFlow) {
    console.log('Deleting existing OTP sub-flow...');
    await kcAdminClient.authenticationManagement.deleteFlow({ flowId: otpFlow.id });
    console.log('  ✓ Deleted');
  }

  // Also remove it from direct grant if it's there
  const directGrantExecs = await kcAdminClient.authenticationManagement.getExecutions({ flow: 'direct grant' });
  const otpExec = directGrantExecs.find(e => e.displayName === 'Direct Grant - Conditional OTP');
  
  if (otpExec) {
    console.log('Removing OTP execution from direct grant...');
    try {
      await kcAdminClient.authenticationManagement.delExecution({ id: otpExec.id });
      console.log('  ✓ Removed');
    } catch (e) {
      console.log('  Cannot remove (built-in flow)');
    }
  }

  console.log('\nNow run the recreate script...');
}

deleteAndRecreateOTP().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
