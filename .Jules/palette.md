## 2024-05-23 - Retrofitting Clickable Divs
**Learning:** Legacy code often uses `div`s with `onclick` for buttons. Retrofitting them requires more than just `role="button"`. You must add `tabindex="0"` for focus and `onkeydown` for keyboard activation (Enter/Space).
**Action:** When spotting `div`s with `onclick`, immediately add the "Holy Trinity" of accessibility: `role`, `tabindex`, and `keydown` handler.
