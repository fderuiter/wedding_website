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

## Code Style

* **TypeScript:** Use it. Try to be explicit with types where it makes sense.
* **React:** Functional components with Hooks are the way.
* **Tailwind CSS:** Utility classes first. Avoid custom CSS unless absolutely necessary.
* **Formatting:** Pretty standard stuff. Try to match the existing code. `npm run lint` might help.

## Code of Conduct

Basically, don't be a jerk. Treat everyone with respect. If you see someone violating this simple rule, let me know.

Thanks again for helping out!
