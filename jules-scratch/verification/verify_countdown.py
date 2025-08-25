from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.goto("http://localhost:3000")

    # Wait for the heading to be visible
    heading = page.get_by_role("heading", name="Abbigayle & Frederick's Wedding")
    expect(heading).to_be_visible(timeout=60000) # wait up to 60 seconds

    # Scroll to the countdown timer
    countdown = page.locator('div[role="timer"]')
    countdown.scroll_into_view_if_needed()

    page.screenshot(path="jules-scratch/verification/verification.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
