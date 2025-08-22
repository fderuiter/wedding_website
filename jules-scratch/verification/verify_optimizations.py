from playwright.sync_api import sync_playwright, Page, expect

def run(page: Page):
    page.goto("http://localhost:3000")

    # The intro animation should start automatically.
    # We can wait for the intro overlay to be present.
    intro_locator = page.locator("div.fixed.inset-0.bg-black")
    expect(intro_locator).to_be_visible()

    # Wait for the fade-in animation of the gallery to complete
    page.wait_for_timeout(1000)

    # While the intro is visible, the underlying page content should also be visible.
    # Let's check for the first gallery.
    gallery_locator = page.locator(".keen-slider").first
    expect(gallery_locator).to_be_visible()

    # And the main heading.
    heading_locator = page.get_by_role("heading", name="Abbigayle & Frederick's Wedding")
    expect(heading_locator).to_be_visible()

    # Take a screenshot showing the intro overlaying the content
    page.screenshot(path="jules-scratch/verification/verification_with_overlay.png")

    # Now, let's wait for the intro to disappear.
    expect(intro_locator).to_be_hidden(timeout=7000) # The animation is 6s, so 7s should be safe.

    # Take another screenshot after the intro is gone.
    page.screenshot(path="jules-scratch/verification/verification_after_overlay.png")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    run(page)
    browser.close()
