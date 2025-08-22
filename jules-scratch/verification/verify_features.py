import time
from playwright.sync_api import sync_playwright, Page, expect

def verify_features(page: Page):
    """
    This script verifies the new frontend features on the registry page.
    """
    # 1. Navigate to the registry page.
    page.goto("http://localhost:3000/registry")

    # 2. Wait for the page to load by waiting for the main heading.
    expect(page.get_by_role("heading", name="Wedding Registry")).to_be_visible(timeout=10000)

    # 3. Wait for the loading skeletons to disappear.
    # We can do this by waiting for the first registry card to appear.
    expect(page.get_by_test_id("registry-card").first).to_be_visible(timeout=10000)

    # 4. Hover over the first card to trigger the hover effect.
    page.get_by_test_id("registry-card").first.hover()

    # Give it a moment for the hover effect to be visible
    time.sleep(0.5)

    # 5. Take a screenshot.
    page.screenshot(path="jules-scratch/verification/features.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        verify_features(page)
        browser.close()
