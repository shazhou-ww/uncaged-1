# Query Full Listing Fix — D1 Fallback Implementation

**Date:** 2025-04-05 04:45 UTC  
**Issue:** #26 - Capability listing returns empty when no `q` parameter (KV region issue)  
**Fix Strategy:** D1 fallback for empty search queries

## Changes Made

### Modified `packages/worker/src/sigil-routes.ts`:

1. **Added SlugResolver import:**
   ```typescript
   import { SlugResolver } from './slug-resolver.js'
   ```

2. **Refactored `handleCapabilityQuery`:**
   - Added early return for empty queries → calls `handleFullListing()`
   - Preserved existing semantic search logic when `q` is provided
   - Maintained all error handling and filtering

3. **Added `handleFullListing()` function:**
   - Uses D1 direct query instead of KV.list()
   - Resolves owner via SlugResolver 
   - Shows owner's + platform capabilities for known users
   - Platform-only capabilities for unknown owners
   - Returns consistent API format

4. **Added `tryParseJson()` helper:**
   - Safe JSON parsing for tags field
   - Returns undefined on parse errors

## Implementation Details

**Query Logic:**
- No `q` param → D1 direct query (bypasses WorkerPool)
- With `q` param → WorkerPool semantic search (unchanged)

**Access Control:**
- Known owner: `owner_id = resolved_id OR owner_id = '__platform__'`
- Unknown owner: `owner_id = '__platform__'` only

**Response Format:**
- Maintains compatibility with existing API
- Maps D1 fields to expected JSON structure
- Includes `access_count`, `score: 1.0` for consistency

## Build Status

✅ **Builds successfully** — no TypeScript errors  
✅ **Generated files updated** — `packages/worker/dist/sigil-routes.js`  

## Next Steps

1. **Deploy to staging** for testing
2. **Verify full listing works** without `q` parameter
3. **Confirm semantic search** still works with `q=xxx`
4. **Consider D1 migration script** for existing KV-only capabilities

## Notes

- **Semantic search preserved** — no changes to WorkerPool logic
- **D1 migration needed** — old capabilities may not appear until re-deployed
- **Dual-write intact** — new deployments populate both KV + D1