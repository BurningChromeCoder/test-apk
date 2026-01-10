## 2025-01-29 - Accessibility in Vanilla JS Apps
**Learning:** In vanilla JS apps using ES modules, event handlers in HTML attributes (like `onclick`) rely on global scope. Adding inline accessibility helpers (like `onkeydown` for divs) is safer done inline or attached to `window` rather than assuming module scope availability.
**Action:** When retrofitting accessibility to legacy/vanilla code, prefer inline event logic for simple keys (Enter/Space) or attach helpers explicitly to `window` to avoid scope issues.
