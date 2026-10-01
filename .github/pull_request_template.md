---
name: Pull Request
about: Describe your changes to help the reviewer.
title: ""
labels: ''
assignees: ''

---

**What kind of change does this PR introduce?** (check all that apply)

- [ ] 🚀 **Application:** Bug fix, UI change, or feature addition (non-breaking)
- [ ] 🗄️ **Schema:** Database schema change (`prisma/schema.prisma` / `prisma/migrations/`)
- [ ] ⚙️ **Configuration:** `AppConfig` schema or environment variable (`src/env.ts`, `.env.example`) change
- [ ] 🐳 **Deployment:** Docker, CI/CD, Node runtime, or infrastructure setup change
- [ ] ⚠️ **Breaking Change:** Fix or feature causing non-backwards-compatible changes
- [ ] 📚 **Documentation:** Changes or additions to documentation pages

**Does this PR require downstream adopter action upon upgrading?**

- [ ] **Yes** (Requires running `npm run migrate:deploy`, updating `.env`, or following migration instructions below)
- [ ] **No** (Transparent upgrade)

**What is the current behavior?** (You can also link to an open issue here)

**What is the new behavior?**

**Does this PR introduce a breaking change or require adopter migration steps?**

- [ ] Yes
- [ ] No

*(If Yes, provide step-by-step migration instructions below for downstream adopters.)*

### Migration Instructions / Adopter Action Steps (if applicable)

```markdown
<!-- Describe exact actions required by adopters (e.g. database migrations, env var additions) -->
```

### Reusability Assessment

- [ ] **Search Existing Logic:** I have searched `src/components` and generic utility directories to confirm this component or helper function does not already exist.
- [ ] **Shared Component Patterns:** If introducing a new shared UI primitive, it is placed in a generic directory (`src/components`), implements React ref forwarding, supports style merging (e.g. Tailwind classes), and includes unit tests.
- [ ] **Stateless Utility Standards:** If introducing a new utility function, it is stateless, domain-agnostic, and placed in a shared utility folder (e.g. `src/lib` or `src/utils`) rather than a feature-specific directory.

**Other information**:
