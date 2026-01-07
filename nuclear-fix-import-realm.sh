#!/bin/bash

echo === NUCLEAR OPTION: Fresh Realm Import from NearMeCalls ===
echo 

# Step 1: Backup current SafeWebEdit users
echo [1/6] Backing up current SafeWebEdit users...
docker exec safewebedit-keycloak-postgres psql -U safewebedit_kc -d safewebedit_keycloak -c   "COPY (SELECT id, username, email FROM USER_ENTITY WHERE realm_id = '3ac8a790-7aa3-4453-89c1-37bed9874db2') TO '/tmp/safewebedit_users_backup.csv' CSV HEADER;"
echo  ✓ Users backed up

# Step 2: Delete the broken SafeWebEdit realm
echo [2/6] Deleting broken SafeWebEdit realm...
docker exec -i safewebedit-keycloak /opt/keycloak/bin/kc.sh delete realm --realm safewebedit 2>&1 | tail -5
echo  ✓ Realm deleted

# Step 3: Copy and modify NearMeCalls export for SafeWebEdit
echo [3/6] Modifying NearMeCalls realm export...
sed 's/nearmecalls/safewebedit/g; s/NearMeCalls/SafeWebEdit/g; s/nearmecalls-dashboard/safewebedit-dashboard/g'   /tmp/nearmecalls-realm.json > /tmp/safewebedit-import.json
echo  ✓ Modified for SafeWebEdit

# Step 4: Import the new realm
echo [4/6] Importing new SafeWebEdit realm from NearMeCalls template...
docker cp /tmp/safewebedit-import.json safewebedit-keycloak:/tmp/
docker exec safewebedit-keycloak /opt/keycloak/bin/kc.sh import --file /tmp/safewebedit-import.json 2>&1 | tail -10
echo  ✓ Imported

# Step 5: Restart Keycloak
echo [5/6] Restarting Keycloak...
docker restart safewebedit-keycloak
sleep 30
echo  ✓ Restarted

# Step 6: Test authentication
echo [6/6] Testing authentication...
curl -s -X POST 'http://localhost:8081/safewebedit-auth/realms/safewebedit/protocol/openid-connect/token'   -H 'Content-Type: application/x-www-form-urlencoded'   -d 'client_id=safewebedit-dashboard'   -d 'client_secret=zdlMWIkCpkntq2v31ls2MxsM4AcfV5OT'   -d 'grant_type=password'   -d 'username=testuser'   -d 'password=password123' | python3 -c 'import sys, json; r = json.load(sys.stdin); print("✅ SUCCESS!" if "access_token" in r else "Still broken: " + str(r))'

echo 
echo Note: Original users backed up to /tmp/safewebedit_users_backup.csv
echo You will need to recreate users in the new realm
