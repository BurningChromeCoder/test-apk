## 2024-05-23 - Accessibility of Interactive Custom Elements
**Learning:** Custom interactive elements (like divs with onclick) are common in this legacy-style codebase. Converting them to semantic `<button>` tags provides immediate accessibility wins (focus, keyboard support) but requires careful CSS resetting (appearance, border, background, font) to maintain visual fidelity.
**Action:** When refactoring interactive divs, always apply `appearance: none`, `background: transparent` (or match original), `border: none` (or match original), and inherit font properties.
