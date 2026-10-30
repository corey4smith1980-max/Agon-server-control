---
name: Agon Clerk React version isolation
description: Keep Clerk's React peer requirements isolated from the workspace React catalog used by Expo.
---

Keep the Agon web artifact on its own compatible React and React DOM versions instead of changing the shared workspace catalog.

**Why:** The shared React catalog is pinned for Expo compatibility, while Clerk requires a newer patch version. A shared change can disturb other artifacts, and Vite may otherwise resolve a sibling artifact's React runtime.

**How to apply:** Pin React and React DOM only in Agon and keep Vite aliases pointed at those local packages. Restart the web workflow after dependency or alias changes so stale optimized modules do not preserve a React version mismatch.
