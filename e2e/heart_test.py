import asyncio
from playwright.sync_api import sync_playwright, Page, expect

def verify_heart_interaction(page: Page):
    """
    This test verifies the interactivity of the heart page.
    It flings the heart to break it and then waits for it to reform.
    """
    # 1. Navigate to the heart page.
    page.goto("http://localhost:3000/heart")

    # Give the page a moment to load the 3D scene
    page.wait_for_timeout(2000)

    # 2. Find the canvas for the drag interaction.
    canvas = page.locator('canvas')
    expect(canvas).to_be_visible()

    # 3. Get the bounding box of the canvas to calculate coordinates
    box = canvas.bounding_box()
    if not box:
        raise Exception("Canvas bounding box not found")

    center_x = box['x'] + box['width'] / 2
    center_y = box['y'] + box['height'] / 2

    # 4. Simulate a drag and fling gesture
    page.mouse.move(center_x, center_y)
    page.mouse.down()
    # Move quickly to the top right to create a fling
    page.mouse.move(center_x + 200, center_y - 200, steps=5)
    page.mouse.up()

    # 5. Wait for the heart to reform
    # The animation takes 3 seconds to reset
    page.wait_for_timeout(4000) # Wait a bit longer to be safe

    # 6. Take a screenshot for visual verification.
    page.screenshot(path="jules-scratch/verification/heart_reformed.png")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        verify_heart_interaction(page)
        browser.close()

if __name__ == "__main__":
    main()
