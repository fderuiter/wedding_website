from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.goto("http://localhost:3000/photos")

    # Click the first image to open the lightbox
    first_image = page.locator('.grid > div').first
    first_image.click()

    # Wait for the lightbox to be visible
    lightbox = page.locator('div[role="dialog"]')
    expect(lightbox).to_be_visible()

    # Wait for the image in the lightbox to be loaded
    lightbox_image = lightbox.locator('img')
    expect(lightbox_image).to_be_visible()

    # Wait for the image to be fully loaded
    lightbox_image.wait_for(state='visible')
    page.wait_for_function("document.querySelector('div[role=\"dialog\"] img').naturalWidth > 0")


    # Take a screenshot of the lightbox
    page.screenshot(path="jules-scratch/verification/gallery_lightbox.png")

    # Click the next button
    next_button = page.get_by_label("Next image")
    next_button.click()

    # Wait for the next image to be loaded
    page.wait_for_function("document.querySelector('div[role=\"dialog\"] img').src.includes('jogging-buddies')")
    page.wait_for_function("document.querySelector('div[role=\"dialog\"] img').naturalWidth > 0")


    # Take a screenshot of the next image
    page.screenshot(path="jules-scratch/verification/gallery_next_image.png")

    # Close the lightbox with the Escape key
    page.press('body', 'Escape')

    # Verify the lightbox is closed
    expect(lightbox).not_to_be_visible()

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
