from playwright.sync_api import sync_playwright

def verify_homepage():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Navigate to the home page
            page.goto("http://localhost:3000")

            # Wait for the main content to be visible (the intro animation might take a moment)
            # We look for the "We Tied the Knot!" heading
            page.wait_for_selector('h1:has-text("We Tied the Knot!")', timeout=15000)

            # Take a screenshot of the home page
            page.screenshot(path="verification/homepage.png")
            print("Homepage screenshot taken.")

            # Navigate to the Registry page
            page.goto("http://localhost:3000/registry")
            page.wait_for_selector('h1:has-text("Wedding Registry")', timeout=10000)
            page.screenshot(path="verification/registry.png")
            print("Registry page screenshot taken.")

        except Exception as e:
            print(f"Error during verification: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_homepage()
