# Project TODOs (Prioritized)

This list is prioritized and each task is clarified with a focus on Test Driven Development (TDD), DRY principles, modularity, best practices, and integration with the current Next.js/TypeScript project structure.

---

## 1. Core Registry Functionality & Data Integrity

- [X] **Add Category and Price Filtering Controls**
  - Implement modular filter components for category and price range on the registry page. Write unit tests for filter logic. Ensure filter state is managed via React state/hooks and is easily testable. Reuse filter logic for both UI and potential backend filtering.

- [X] **Group Gift Progress Bar & Contributor List**
  - In the item modal, show a progress bar for group gifts and list contributors. Make the progress bar a reusable component. Write tests for progress calculation and rendering. Ensure contributor data is displayed securely and accessibly.

- [X] **Visual Indicator for Claimed/Funded Items**
  - Add a visual overlay or style change for fully claimed/funded items in RegistryCard. Use a DRY approach by centralizing status logic. Test that claimed items are correctly indicated in all UI states.

- [X] **Optimistic UI Updates After Contribution/Claim**
  - Update the UI immediately after a contribution/claim, then confirm with API response. Use React Query or similar for state management if needed. Write integration tests to ensure UI state matches backend state.

- [X] **Validation and Error Handling for API Endpoints**
  - Add comprehensive validation and error handling to all API endpoints (e.g., contribute, add-item). Use a shared validation utility. Write API tests for all error cases. Ensure error messages are user-friendly and secure.

---

## 2. Admin & Management

- [X] **Protected Admin Dashboard (CRUD for Items & Contributions)**
  - Create an admin dashboard page (modular, route-protected) for listing, editing, deleting, and adding registry items. Use TDD: write tests for all CRUD operations. Use DRY form components for add/edit. Integrate with existing API endpoints and extend as needed.

- [ ] **Authentication for Admin Routes/Pages**
  - Implement password-based authentication using environment variables. Use secure cookie/session storage. Write tests for login/logout and access control. Ensure admin-only endpoints are protected on both frontend and backend.

- [ ] **Add Item Form with URL Scraping and Manual Entry**
  - Build a modular form for adding items, supporting both manual entry and URL-based scraping (integrate with existing /api/registry/scrape). Write tests for form validation and scraping logic. Reuse form for editing items.

- [ ] **Manual Mark as Claimed/Received (Admin)**
  - Allow admin to manually mark items as claimed/received. Integrate with item edit form. Test that manual changes update data and UI correctly.

- [ ] **Admin View of All Contributions**
  - Show a table of all contributions in the admin dashboard. Write tests for correct aggregation and display. Allow export as CSV (optional, modular utility).

---

## 3. UI/UX, Accessibility, and SEO

- [X] **Mobile Responsiveness & Accessibility**
  - Ensure all components are responsive and accessible (focus trap in modals, ARIA roles, keyboard navigation). Use Storybook or similar for visual testing. Write accessibility tests.

- [ ] **Image Gallery/Video Support in Modals**
  - Allow multiple images or video in item modals. Use a modular gallery component. Write tests for media rendering and navigation.

- [ ] **Icons for Filters/Search & Touch-Friendly Design**
  - Add icons and improve touch targets for mobile. Use a shared icon component. Test usability on mobile devices.

- [ ] **SEO: Meta Tags, Open Graph, Twitter Card, JSON-LD**
  - Add dynamic meta tags and structured data (Event schema for landing, Product schema for registry) using Next.js Head. Write tests to verify correct tags are rendered. Add sitemap.xml and robots.txt.

---

## 4. Backend, Data, and Persistence

- [X] **Migrate to SQLite or Real DB for Production**
  - Replace JSON file with SQLite (using Prisma or similar ORM). Write migration scripts and tests for DB operations. Ensure all data access is via modular repository/service layer. Update API endpoints to use DB.

- [ ] **Provide Sample Data & Config for Site Settings**
  - Move site-specific content (names, date, venue) to a config file or DB. Write tests to ensure config is loaded and used throughout the app. Document how to update settings.

---

## 5. Testing, Quality, and CI

- [ ] **Unit and Integration Tests for Backend Logic**
  - Add tests for all backend logic (contribution, claim, scraping). Use Jest or similar. Ensure all edge cases are covered.

- [ ] **End-to-End Tests for Main User Flows**
  - Use Playwright or Cypress to test registry browsing, searching, claiming, and contributing. Integrate with CI.

- [ ] **Linting, Formatting, and CI Setup**
  - Add ESLint, Prettier, and GitHub Actions for lint/test on PRs. Write a CONTRIBUTING.md with code style and test requirements.

---

## 6. Deployment & Documentation

- [ ] **Deployment/Setup Guide**
  - Write clear deployment instructions (Vercel/Netlify/self-host). Include DB setup, env vars, and troubleshooting. Test the guide by following it from scratch.

- [ ] **Document Environment Variables & Configuration**
  - Ensure all required env vars are documented in .env.example and README. Test that missing vars cause clear errors.

- [ ] **Add CONTRIBUTING.md and ROADMAP.md**
  - Write guidelines for contributors and a roadmap for future features. Keep docs modular and up to date.

- [ ] **Add Screenshots or Demo Link to README**
  - Add images or a demo link to README for open source appeal. Test that images render correctly on GitHub.

---

## 7. Future/Optional Enhancements

- [ ] **Payment Integration (Stripe, PayPal, etc.)**
  - Modularize payment logic for easy opt-in. Write tests for payment flows. Document security considerations.

- [ ] **Guest Personalization, Multi-language, Gallery, RSVP**
  - Design these as modular extensions. Write tests and docs for each. Integrate only if needed for your use case.

---

*Each task should be implemented with TDD in mind, using modular, DRY components and utilities, and following best practices for maintainability and scalability. Integrate new features into the existing Next.js/TypeScript structure, reusing and extending current components and API routes where possible.*
