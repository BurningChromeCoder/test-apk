## 2024-05-23 - Accessibility First for Controls
**Learning:** Adding `aria-label` to icon-only buttons is a high-impact, low-risk micro-UX improvement that drastically improves usability for screen reader users without affecting visual design.
**Action:** Always check icon-only controls for accessible labels during initial observation.

## 2024-05-23 - Interactive Divs vs Buttons
**Learning:** When constrained to "no new CSS", patching clickable divs with `role="button"`, `tabindex="0"`, and `onkeydown` is a valid strategy to maintain exact visual fidelity while fixing accessibility, though converting to semantic `<button>` is preferred when style resets are easy.
**Action:** Verify if existing CSS selectors target `div#id` or just `#id` before converting elements.
