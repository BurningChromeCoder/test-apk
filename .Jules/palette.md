## 2024-05-23 - Converting Legacy Interactive Divs
**Learning:** Legacy "app-like" interfaces often misuse `div`s for buttons to achieve circular styles without default button border/padding interference.
**Action:** When converting to semantic `<button>`, ensure to verify `border`, `background`, and `padding` resets are not needed, or rely on existing classes that set them explicitly. In this case, `.timbre-btn` handled styles well, but I should always double-check default browser styles for buttons don't leak through.
