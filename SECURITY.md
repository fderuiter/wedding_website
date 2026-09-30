# Security Policy

## Threat Model & Architecture
For a detailed analysis of trust boundaries, asset inventory, threat vectors, and active security controls in this codebase, please review the [Lightweight Threat Model](docs/THREAT_MODEL.md).

## Supported Versions

We maintain security updates on the default `main` branch.

| Version          | Supported          | Notes                                      |
| ---------------- | ------------------ | ------------------------------------------ |
| `main` Branch    | :white_check_mark: | Actively supported release branch.          |
| Older Commits    | :x:                | Upstream fixes should be merged to `main`. |

## Template Deployers & Self-Hosters

If you are deploying this template for your own event, please ensure:
1. You generate unique credentials for `ADMIN_PASSWORD` (using `scripts/generate-password-hash.mjs`) and a unique `GUEST_PASSCODE`.
2. You configure `ALLOWED_HOSTS` to match your actual domain name(s).
3. If hosting publicly, replace the security contact email below with your own contact address in your fork or deployment settings.

## Reporting a Vulnerability

Found a security issue or vulnerability? We appreciate responsible disclosure to help keep the project safe.

**How to Report:**

* Please email details to `fpderuiter@gmail.com`. **Please do not open public GitHub issues for security vulnerabilities.**
* Include steps to reproduce, potential impact assessment, and any relevant code snippets or proof of concept.

**What Happens Next:**

* We aim to acknowledge reports within 48 hours.
* We will investigate the issue and communicate target resolution timelines within 7 business days.
* Once a fix is verified and deployed, security updates will be documented on the main branch.

Thanks for helping keep this project secure!

## Core Security Controls

- **No Default Passwords:** The system never ships with universal default administrative passwords.
- **Password Hashing:** Admin passwords use scrypt key derivation function (`scrypt:[saltBase64]:[keyBase64]`).
- **First-Run Bootstrap Protection:** First-run initialization requires validating against `ADMIN_PASSWORD`. Once initialized, setup endpoints reject unauthorized replay attempts (`403 Forbidden`).
