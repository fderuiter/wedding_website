# Contributor Guidelines

## Linting & Testing
- Run `npm run lint` and `npm test` before committing. Note that some tests may fail as mentioned in [README.md](README.md).

## Commit Messages
- Use the style `feat:`, `fix:`, `docs:`, etc. Follow the existing PR and issue templates in [.github/](.github/).

## Ignored Files
- Do **not** commit `.env*` files, `prisma/registry.db`, coverage reports, or build artifacts.

## Prisma Schema Changes
- After modifying `prisma/schema.prisma`, run:
  - `npm run migrate:dev` during development.
  - `npm run migrate:deploy` for deployment.
- Commit the generated migrations.

## Development Practices
- Prefer TypeScript and functional React components.
- Use `next/image` for images when possible.

## Security
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
