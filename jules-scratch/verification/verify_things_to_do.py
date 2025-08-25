from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.goto("http://localhost:3000/things-to-do")

    # Take a screenshot of the initial page
    page.screenshot(path="jules-scratch/verification/things_to_do_initial.png")

    # Click the "Food" filter button
    food_button = page.get_by_role("button", name="Food")
    food_button.click()

    # Take a screenshot to verify the filter is applied
    page.screenshot(path="jules-scratch/verification/things_to_do_food_filter.png")

    # Click the "All" filter button
    all_button = page.get_by_role("button", name="All")
    all_button.click()

    # Take a screenshot to verify the filter is reset
    page.screenshot(path="jules-scratch/verification/things_to_do_all_filter.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
