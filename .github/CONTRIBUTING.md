# Contributing to This Glorious Wedding Website Thing

First off, thanks for considering contributing! Seriously, you clicking here is probably the highlight of my week. Whether you found a bug that annoys you more than a misplaced seating card, have a genius idea for a feature (like, maybe, automatically RSVPing 'yes' for everyone?), or just want to fix my questionable code, your help is appreciated.

This project, while built for a specific wedding, is also a bit of a portfolio piece and an experiment in slightly-too-complex-for-a-wedding-website engineering. So, let's keep it fun and maybe slightly professional.

## Ground Rules (The "Please Don't Make Me Cry" List)

1. **Be Nice:** Seriously. We're all just trying to make cool stuff (or, in this case, a functional website). Let's be respectful and constructive.
2. **Check Existing Issues:** Before you file a new bug report or feature request, please take a quick peek at the [existing issues](https://github.com/fderuiter/wedding_website/issues) to see if someone else has already mentioned it. Maybe add a thumbs-up or your own details to an existing issue.
3. **Use the Templates:** When you *do* create a new issue, please use the provided templates (Bug Report, Feature Request, Docs Improvement). They help me understand what's going on without needing a crystal ball.

## How to Contribute (The Fun Part!)

1. **Fork the Repo:** Click that 'Fork' button up top. This creates your own copy of the project.
2. **Clone Your Fork:**

    ```bash
    git clone https://github.com/YOUR_USERNAME/wedding_website.git
    cd wedding_website
    ```

3. **Set Up:** Follow the setup instructions in the main [README.md](https://github.com/fderuiter/wedding_website/blob/main/README.md#getting-started). Make sure you can run the project locally (`npm run dev`).
4. **Create a Branch:** Make a new branch for your changes. Name it something descriptive, like `fix/registry-typo` or `feat/add-confetti-button`.

    ```bash
    git checkout -b fix/registry-typo
    ```

5. **Make Your Changes:** Write your code, fix the bug, improve the docs. Try to stick to the existing code style (TypeScript, React, Tailwind utility classes). Run `npm run lint` if you want to check for basic style issues (though it's not super strict right now).
6. **Test Your Changes:** If you added a feature or fixed a bug, make sure it works! Manual testing is fine. If you're feeling *really* ambitious, you could even add a test (see the `*.test.tsx` files for examples), but no pressure.
7. **Commit Your Changes:** Write clear commit messages. Something like `fix: Correct spelling on registry item description` or `feat: Add animation to RSVP button`.

    ```bash
    git add .
    git commit -m "fix: Correct spelling on registry item description"
    ```

8. **Push to Your Fork:**

    ```bash
    git push origin fix/registry-typo
    ```

9. **Open a Pull Request (PR):** Go back to the *original* `fderuiter/wedding_website` repository on GitHub. You should see a prompt to create a Pull Request from your new branch. Click it!
    * Give your PR a clear title and description.
    * Reference any relevant issues (e.g., "Fixes #123").
    * Explain *what* you changed and *why*.

10. **Wait Patiently:** I'll review the PR as soon as I can. I might ask for changes or clarification. Once it's approved, I'll merge it in. You're a contributor!

## A Note on Documentation

We are actively working to improve the documentation for this project. If you make a change that requires a documentation update, please make the corresponding change to the documentation as part of your pull request.

## Shared Code and Reusability Guidelines

To minimize codebase bloat and prevent technical debt, we enforce a strict manual review process for shared code reusability. Before creating any new UI component or utility function, you must verify if a suitable solution already exists.

### Step-by-Step Verification Process

1. **Search Existing Codebase:**
   * Run a global search or check the `src/components/ui/` folder for existing visual elements (e.g., buttons, overlays, form inputs).
   * Run a global search or check the `src/utils/` and `src/lib/` directories for common helper logic (e.g., date helpers, class merging utilities, client wrappers).
2. **Review Existing Files Directly:**
   * Browse `src/components/ui/` and `src/utils/` to see if there is an existing component or function that can be extended or configured via props/arguments instead of writing a new one from scratch.
3. **Ask/Consult:**
   * For non-trivial logic, consult other contributors or review existing open pull requests to check if someone else is already implementing a similar helper or component.
4. **Determine Placement:**
   * If the logic is specific only to one domain or feature (e.g., RSVP list table, weather-specific widget), place it in `src/features/<feature-name>/{components,hooks}/`. Keep it isolated from the generic shared folders.
   * If the logic is general-purpose, reusable, and domain-agnostic, it should be placed in `src/components/ui/` (for UI primitives) or `src/utils/` (for stateless utilities).

### Standards for Shared Utility Functions

All new utility functions placed in the global `src/utils/` folder must follow these strict style and location standards:
* **Domain-Agnostic:** They must be generic and completely decoupled from specific business logic, wedding details, or feature schemas. For example, a function to format dates (`formatDate`) is domain-agnostic, while a function to format RSVP-specific registry items belongs in the registry feature folder.
* **Stateless and Pure:** Utility functions must be pure functions with no side effects. They must not rely on global state, mutable external variables, or perform asynchronous networking. Given the same inputs, they must always return the same outputs.
* **TypeScript & Quality:** Explicitly define TypeScript argument and return types. Avoid the use of `any`.
* **Placement:**
  * Place domain-agnostic, stateless helpers in `/app/src/utils/` (e.g., as standalone utility files or added to an existing domain-agnostic utility file).
  * Ensure that feature-specific logic is strictly isolated in feature-specific subdirectories under `src/features/`.

## Code Style

* **TypeScript:** Use it. Try to be explicit with types where it makes sense.
* **React:** Functional components with Hooks are the way.
* **Tailwind CSS:** Utility classes first. Avoid custom CSS unless absolutely necessary.
* **Formatting:** Pretty standard stuff. Try to match the existing code. `npm run lint` might help.

## Code of Conduct

Basically, don't be a jerk. Treat everyone with respect. If you see someone violating this simple rule, let me know.

Thanks again for helping out!
