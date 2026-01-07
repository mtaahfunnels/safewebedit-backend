const KcAdminClient = require('@keycloak/keycloak-admin-client').default;

async function verifyUserExists() {
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

    const username = '98105cbc-2caf-4f16-b250-e8642126e619';

    console.log('Looking up user by username:', username);
    
    // Find user by username
    const users = await kcAdminClient.users.find({ username: username });
    
    console.log('\nSearch results:', users.length, 'user(s) found');
    
    if (users.length > 0) {
      users.forEach((user, index) => {
        console.log('\nUser', index + 1);
        console.log('  ID:', user.id);
        console.log('  Username:', user.username);
        console.log('  Email:', user.email);
        console.log('  Enabled:', user.enabled);
        console.log('  Email Verified:', user.emailVerified);
        console.log('  Required Actions:', user.requiredActions);
      });
    } else {
      console.log('\n❌ USER NOT FOUND!');
      console.log('The user has been deleted or username search is not working');
    }

    // Also try exact match
    console.log('\n---');
    console.log('Trying exact match search...');
    const exactUsers = await kcAdminClient.users.find({ 
      username: username,
      exact: true 
    });
    
    console.log('Exact match results:', exactUsers.length, 'user(s)');

    if (exactUsers.length === 0) {
      console.log('\nListing ALL users in realm...');
      const allUsers = await kcAdminClient.users.find({ max: 100 });
      console.log('Total users in realm:', allUsers.length);
      allUsers.forEach(u => {
        console.log('  -', u.username, '(ID:', u.id + ')');
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

verifyUserExists();
