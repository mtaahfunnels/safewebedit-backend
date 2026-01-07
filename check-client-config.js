const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function checkClientConfig() {
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

    // Find client
    const clients = await kcAdminClient.clients.find({ clientId: 'safewebedit-dashboard' });
    
    if (clients.length === 0) {
      console.log('❌ Client not found!');
      process.exit(1);
    }

    const client = clients[0];
    console.log('Client Configuration:');
    console.log('  ID:', client.id);
    console.log('  Client ID:', client.clientId);
    console.log('  Enabled:', client.enabled);
    console.log('  Public Client:', client.publicClient);
    console.log('  Direct Access Grants Enabled:', client.directAccessGrantsEnabled);
    console.log('  Standard Flow Enabled:', client.standardFlowEnabled);
    console.log('  Implicit Flow Enabled:', client.implicitFlowEnabled);
    console.log('  Service Accounts Enabled:', client.serviceAccountsEnabled);

    if (!client.directAccessGrantsEnabled) {
      console.log('\n⚠️  Direct Access Grants is DISABLED!');
      console.log('Enabling it now...');
      
      await kcAdminClient.clients.update(
        { id: client.id },
        {
          ...client,
          directAccessGrantsEnabled: true
        }
      );
      
      console.log('✓ Direct Access Grants enabled');
    } else {
      console.log('\n✓ Direct Access Grants is enabled');
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

checkClientConfig();
