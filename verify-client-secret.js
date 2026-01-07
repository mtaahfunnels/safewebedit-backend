const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function verifyClientSecret() {
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

    // Get client
    const clients = await kcAdminClient.clients.find({ clientId: 'safewebedit-dashboard' });
    const client = clients[0];

    console.log('Client: safewebedit-dashboard');
    console.log('  ID:', client.id);
    
    // Get client secret
    const secret = await kcAdminClient.clients.getClientSecret({ id: client.id });
    
    console.log('  Current Secret:', secret.value);
    console.log('  Expected Secret: zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT');
    
    if (secret.value === 'zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT') {
      console.log('  ✓ Secret matches!');
    } else {
      console.log('  ✗ SECRET MISMATCH!');
      console.log('\nUpdating client secret...');
      
      await kcAdminClient.clients.update(
        { id: client.id },
        {
          ...client,
          secret: 'zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT'
        }
      );
      
      console.log('✓ Secret updated');
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

verifyClientSecret();
