from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    page.goto("http://localhost:3000")

    # The intro animation might delay the appearance of the button.
    # We'll wait for the main content to be visible.
    page.wait_for_selector("#main")

    # There are two "Add to Calendar" buttons, we'll use the first one.
    add_to_calendar_button = page.get_by_role("button", name="Add to Calendar").first

    # Ensure the button is visible before clicking
    expect(add_to_calendar_button).to_be_visible()

    add_to_calendar_button.click()

    # Wait for the dropdown to be visible
    menu = page.locator("div[role='menu']")
    expect(menu).to_be_visible()

    page.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
