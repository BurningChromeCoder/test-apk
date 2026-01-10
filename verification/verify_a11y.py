from playwright.sync_api import sync_playwright, expect

def test_accessibility(page):
    page.goto("http://localhost:5173")

    # Wait for the page to load
    page.wait_for_selector("#onboarding", state="visible")

    # 1. Verify Ringtone Selector ARIA label
    # The selector is hidden behind #onboarding, but it exists in DOM.
    # We can check attributes directly.
    ringtone_selector = page.locator("#ringtone-type")
    expect(ringtone_selector).to_have_attribute("aria-label", "Seleccionar tono de llamada")
    print("✅ Ringtone selector has aria-label")

    # 2. Verify DND Toggle ARIA label
    dnd_toggle = page.locator("#dnd-toggle")
    expect(dnd_toggle).to_have_attribute("aria-label", "Activar modo No Molestar")
    print("✅ DND toggle has aria-label")

    # 3. Verify Battery Optimization Button
    battery_btn = page.locator("#battery-opt-wrapper")
    expect(battery_btn).to_have_attribute("role", "button")
    expect(battery_btn).to_have_attribute("tabindex", "0")
    expect(battery_btn).to_have_attribute("aria-label", "Solicitar optimización de batería")
    print("✅ Battery optimization div has role=button and aria-label")

    # 4. Verify Icon-only buttons (Start Button)
    # The start button has text "Entrar", so it was not modified to have aria-label in the plan?
    # Wait, the plan said "Add ARIA label to all icon-only buttons (.btn-hangup, .btn-answer, .btn-mute)".
    # Let's check those.

    # We need to dismiss onboarding to interact with some controls,
    # but since they are in DOM we can check attributes.

    # .btn-hangup appears in two places (#controls-incoming and #controls-active)
    hangup_btns = page.locator(".btn-hangup")
    # Check the first one
    expect(hangup_btns.first).to_have_attribute("aria-label", "Rechazar llamada") # or Finalizar depending on which one is first
    print("✅ Hangup button has aria-label")

    # .btn-answer
    answer_btn = page.locator(".btn-answer")
    expect(answer_btn).to_have_attribute("aria-label", "Contestar llamada")
    print("✅ Answer button has aria-label")

    # .btn-mute
    mute_btn = page.locator("#btn-mute")
    expect(mute_btn).to_have_attribute("aria-label", "Silenciar micrófono")
    print("✅ Mute button has aria-label")

    # Take screenshot of the initial state (Onboarding)
    page.screenshot(path="verification/onboarding_a11y.png")

    # Click Entrar to reveal main UI
    page.click(".btn-start")
    page.wait_for_selector("#onboarding", state="hidden")

    # Take screenshot of main UI
    page.screenshot(path="verification/main_ui_a11y.png")
    print("📸 Screenshots taken")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            test_accessibility(page)
        except Exception as e:
            print(f"❌ Test failed: {e}")
            page.screenshot(path="verification/error.png")
            raise e
        finally:
            browser.close()
