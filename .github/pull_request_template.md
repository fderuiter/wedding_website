---
name: Pull Request
about: Describe your changes to help the reviewer.
title: ""
labels: ''
assignees: ''

---

**What kind of change does this PR introduce?** (check at least one)

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation (change to documentation pages)
- [ ] Other (please describe):

**What is the current behavior?** (You can also link to an open issue here)

**What is the new behavior?**

**Does this PR introduce a breaking change?**

- [ ] Yes
- [ ] No

(If this PR contains a breaking change, please describe the impact and migration path for existing applications below.)

### Reusability Assessment

- [ ] **Search Existing Logic:** I have searched `src/components` and generic utility directories to confirm this component or helper function does not already exist.
- [ ] **Shared Component Patterns:** If introducing a new shared UI primitive, it is placed in a generic directory (`src/components`), implements React ref forwarding, supports style merging (e.g. Tailwind classes), and includes unit tests.
- [ ] **Stateless Utility Standards:** If introducing a new utility function, it is stateless, domain-agnostic, and placed in a shared utility folder (e.g. `src/lib` or `src/utils`) rather than a feature-specific directory.

**Other information**:
