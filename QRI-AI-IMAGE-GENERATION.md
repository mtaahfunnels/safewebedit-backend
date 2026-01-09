# QRI: AI Image Generation System
**Quick Reference Index**  
**Component:** SafeWebEdit Visual Editor - AI Image Generator  
**Last Updated:** 2026-01-09

## 🔧 Quick Debug Checklist

When AI image generation fails, check in this order:

1. **Check fal.ai account balance**
   ```bash
   # Visit: https://fal.ai/dashboard/billing
   # Balance should be > $0.00
   ```

2. **Check API key is set**
   ```bash
   grep FAL_KEY /root/safewebedit/backend/.env
   # Should return: FAL_KEY=xxx...xxx
   ```

3. **Check backend logs**
   ```bash
   pm2 logs safewebedits-api --lines 30 | grep -A 10 'AI-IMAGE-GEN\|FAL.AI'
   ```

4. **Test fal.ai API directly**
   ```bash
   curl -X POST 'https://queue.fal.run/fal-ai/flux-pro/v1.1'      -H "Authorization: Key $(grep FAL_KEY /root/safewebedit/backend/.env | cut -d= -f2)"      -H 'Content-Type: application/json'      -d '{"prompt":"test","image_size":{"width":512,"height":512}}'
   ```

## 📁 File Locations

| File | Path | Purpose |
|------|------|---------|
| **AI Image Gen API** | `src/api/routes/ai-image-gen.js` | Main fal.ai integration |
| **Visual Proxy** | `src/api/routes/visual-proxy.js` | Image click detection |
| **Frontend Page** | `frontend/app/dashboard/visual/page.tsx` | Visual Editor UI |
| **Environment** | `.env` | FAL_KEY configuration |
| **Server Config** | `src/server.js` | Route registration |

## 🔌 API Endpoints

### fal.ai Endpoints
```
POST https://queue.fal.run/fal-ai/flux-pro/v1.1
GET  https://queue.fal.run/fal-ai/flux-pro/requests/{request_id}
POST https://queue.fal.run/fal-ai/flux/schnell (backup)
```

### Internal Endpoints
```
POST /api/ai-image-gen/generate  - Generate image
POST /api/ai-image-gen/analyze   - Analyze image
GET  /api/ai-image-gen/test      - Health check
```

## 💾 Environment Variables

```bash
# Required
FAL_KEY=your_fal_api_key_here

# Optional (for backups)
REPLICATE_API_TOKEN=xxx
OPENAI_API_KEY=xxx (for GPT-4 Vision analysis)
```

## 💰 Pricing & Credits

| Provider | Cost | Free Tier |
|----------|------|-----------|
| **fal.ai FLUX Pro** | $0.008/image | No |
| **fal.ai FLUX Schnell** | $0.010/image | No |
| **Replicate** | $0.0055/image | 50/month |
| **Canvas Fallback** | FREE | Unlimited |

**Current Balance:** Check at https://fal.ai/dashboard/credits

## 🚨 Common Error Messages

### "User is locked. Reason: Exhausted balance"
- **Cause:** fal.ai account has $0.00 balance
- **Fix:** Add credits at https://fal.ai/dashboard/billing
- **Prevention:** Enable auto top-up

### "Request failed with status code 404"
- **Cause:** Incorrect API endpoint URL
- **Fix:** Verify using `flux-pro/v1.1` not `flux-2-turbo`
- **Check:** `grep 'fal.run' src/api/routes/ai-image-gen.js`

### "Request failed with status code 400" during polling
- **Cause:** Image not ready yet (normal during polling)
- **Fix:** Should be caught and ignored automatically
- **Check:** Verify try-catch exists around polling loop

### "Generation timeout after 30 seconds"
- **Cause:** Image took too long or polling failed
- **Fix:** Increase timeout or check fal.ai service status
- **Debug:** Check logs for polling errors

### "All AI services failed, using canvas fallback"
- **Cause:** All providers failed (fal.ai + backups)
- **Result:** Blue gradient canvas displayed
- **Fix:** Check each provider's status/credits

## 🧪 Testing Commands

### Test AI Generation Directly
```bash
curl -X POST http://localhost:5005/api/ai-image-gen/generate   -H 'Content-Type: application/json'   -H 'Authorization: Bearer YOUR_USER_TOKEN'   -d '{
    "prompt": "a beautiful sunset",
    "width": 800,
    "height": 600,
    "user_tier": "pro"
  }'
```

### Test Health Check
```bash
curl http://localhost:5005/api/ai-image-gen/test
```

### Test fal.ai Polling
```bash
# Replace REQUEST_ID with actual ID from logs
curl https://queue.fal.run/fal-ai/flux-pro/requests/REQUEST_ID   -H "Authorization: Key $(grep FAL_KEY /root/safewebedit/backend/.env | cut -d= -f2)"
```

## 🔄 Restart Commands

```bash
# Restart backend only
pm2 restart safewebedits-api

# Restart frontend only  
pm2 restart safewebedit-frontend

# Restart both
pm2 restart safewebedits-api safewebedit-frontend

# View logs
pm2 logs safewebedits-api --lines 50
```

## 📊 Monitoring

### Check Current Usage
```bash
# View recent AI generation logs
pm2 logs safewebedits-api --lines 100 | grep AI-IMAGE-GEN

# Count generations today
pm2 logs safewebedits-api --lines 1000 | grep -c 'AI-IMAGE-GEN.*Generating'

# View failures
pm2 logs safewebedits-api --lines 500 | grep 'AI-IMAGE-GEN.*failed'
```

### Check fal.ai Credits
- Dashboard: https://fal.ai/dashboard/credits
- Usage: https://fal.ai/dashboard/usage

## 🛠️ Manual Fixes

### Fix: Re-add Image Click Detection
```bash
cd /root/safewebedit/backend
git checkout src/api/routes/visual-proxy.js  # Restore clean version
# Then manually add image detection code
```

### Fix: Reset to Working Version
```bash
cd /root/safewebedit/backend
git log --oneline src/api/routes/ai-image-gen.js  # Find working commit
git checkout COMMIT_HASH -- src/api/routes/ai-image-gen.js
pm2 restart safewebedits-api
```

### Fix: Regenerate FAL_KEY
1. Go to: https://fal.ai/dashboard/keys
2. Create new API key
3. Update: `echo 'FAL_KEY=new_key' >> /root/safewebedit/backend/.env`
4. Restart: `pm2 restart safewebedits-api`

## 📝 Code Snippets

### Check if User is PRO
```javascript
const userTier = req.user?.subscription_tier || 'free';
if (userTier === 'pro' || userTier === 'business') {
  // Use fal.ai
} else {
  // Use canvas fallback
}
```

### Correct Polling Pattern
```javascript
for (let i = 0; i < 30; i++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  try {
    const statusResponse = await axios.get(resultUrl, {
      headers: { 'Authorization': `Key ${FAL_KEY}` }
    });
    
    if (statusResponse.data.images?.length > 0) {
      return statusResponse.data.images[0].url;
    }
  } catch (pollError) {
    // Ignore 400/404 (not ready yet)
    if (pollError.response?.status !== 400 && 
        pollError.response?.status !== 404) {
      console.log("Polling error:", pollError.message);
    }
  }
}
```

## 🔗 Related Documentation

- [MTT-SESSION-2026-01-09-FAL-AI-FIX.md](./MTT-SESSION-2026-01-09-FAL-AI-FIX.md) - Full debug session
- [fal.ai API Docs](https://docs.fal.ai/model-apis/quickstart)
- [FLUX Pro v1.1 API](https://fal.ai/models/fal-ai/flux-pro/v1.1/api)

---

**Last Verified:** 2026-01-09  
**System Status:** ✅ Operational  
**fal.ai Balance:** $20.00 (Auto top-up enabled)
