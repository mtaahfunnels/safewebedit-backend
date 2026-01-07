const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function checkClientFlows() {
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

    const clients = await kcAdminClient.clients.find({ clientId: 'safewebedit-dashboard' });
    const client = clients[0];

    console.log('Client Authentication Flow Overrides:');
    console.log('  Browser Flow:', client.authenticationFlowBindingOverrides?.browser || '(default)');
    console.log('  Direct Grant Flow:', client.authenticationFlowBindingOverrides?.direct_grant || '(default)');
    console.log('\nClient Settings:');
    console.log('  Direct Access Grants:', client.directAccessGrantsEnabled);
    console.log('  Standard Flow:', client.standardFlowEnabled);
    console.log('  Implicit Flow:', client.implicitFlowEnabled);
    console.log('  Service Accounts:', client.serviceAccountsEnabled);

    // If there's a custom direct grant flow override, check it
    if (client.authenticationFlowBindingOverrides?.direct_grant) {
      console.log('\n⚠️  Client has custom direct grant flow override!');
      console.log('Removing override to use realm default...');
      
      await kcAdminClient.clients.update(
        { id: client.id },
        {
          ...client,
          authenticationFlowBindingOverrides: {
            ...client.authenticationFlowBindingOverrides,
            direct_grant: null
          }
        }
      );
      
      console.log('✓ Override removed');
    } else {
      console.log('\n✓ Client is using realm default direct grant flow');
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response && error.response.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

checkClientFlows();
