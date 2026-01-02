## 2024-05-22 - [Accessibility: Keyboard & Screen Reader Support for Custom Controls]
**Learning:** Custom UI elements like divs with `onclick` (e.g., the battery optimization button) are completely invisible to keyboard users and screen readers unless explicitly given roles and tabindex.
**Action:** When using non-standard interactive elements, always add `role="button"`, `tabindex="0"`, and `onkeydown` handlers for Enter/Space, along with descriptive `aria-label`s.
