## 2024-05-23 - Accessibility Improvements
**Learning:** Converting `div` elements with `onclick` handlers to semantic `<button>` elements is highly effective for accessibility but requires careful CSS resets (e.g., `color`, `font-family`, `border`) to match the original design, especially when the original element relied on inherited styles that buttons do not inherit by default.
**Action:** When semantically upgrading elements, always verify computed styles and explicitly inherit properties like font and color if they differ from user-agent defaults.
