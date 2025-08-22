from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3000/heart")

    # Wait for the canvas to be visible
    canvas = page.locator('canvas')
    expect(canvas).to_be_visible(timeout=15000)

    # Wait for the heart to load
    page.wait_for_timeout(2000)
    page.screenshot(path="jules-scratch/verification/heart_initial_pulse.png")

    # Interact with the heart to trigger faster pulse
    canvas.click()
    page.wait_for_timeout(250) # wait for the pulse to be at its peak
    page.screenshot(path="jules-scratch/verification/heart_fast_pulse.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
