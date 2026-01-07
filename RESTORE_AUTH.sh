#!/bin/bash

echo "================================================"
echo "Restoring Authentication to Google Sheets API"
echo "================================================"
echo ""

# Restore the original file
if [ -f "/root/safewebedit/backend/src/api/routes/google-sheets.js.WITH_AUTH" ]; then
    cp /root/safewebedit/backend/src/api/routes/google-sheets.js.WITH_AUTH \
       /root/safewebedit/backend/src/api/routes/google-sheets.js
    echo "✓ Restored google-sheets.js with authentication"
    
    # Restart backend
    pm2 restart safewebedits-api --update-env
    echo "✓ Backend restarted"
    
    sleep 2
    
    # Verify
    pm2 list | grep safewebedits-api | grep online && echo "✓ Backend online"
    
    echo ""
    echo "================================================"
    echo "✓ Authentication restored successfully!"
    echo "================================================"
    echo ""
    echo "Google Sheets API now requires authentication again."
else
    echo "✗ Backup file not found!"
    exit 1
fi
