## 2025-12-10 - Render Blocking & Bundle Size
**Learning:** Checking `localStorage` in `useEffect` and returning `null` while waiting for it causes a significant delay in First Contentful Paint (FCP). Combined with a heavy unused dynamic import (Three.js), this created a poor initial loading experience.
**Action:** Remove blocking checks on the critical path. Ensure dynamic imports are actually used or remove them to avoid unnecessary chunk loading.
