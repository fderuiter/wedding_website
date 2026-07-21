# Pro-Grade Deployment Pipeline Documentation

This repository includes a pro-grade deployment pipeline suitable for enterprise cloud migration, multi-cloud hosting, and zero-downtime schema updates.

## GitHub Actions Workflows

We provide two pre-configured GitHub Actions workflows:

1. **CI Pipeline (`ci.yml`)**: Triggers on Pull Requests and pushes to `main`. It builds the application, runs unit tests, and executes end-to-end (e2e) Playwright tests.
2. **Deploy Pipeline (`deploy.yml`)**: Triggers on pushes to `main`. It automates the database migration and builds a multi-platform Docker container image (`linux/amd64` and `linux/arm64`).

## Setup and Secrets

To ensure the automated workflows succeed, you must add the following **Repository Secrets** in your GitHub repository (`Settings > Secrets and variables > Actions`):

- `DATABASE_URL`: The connection string to your production PostgreSQL database. *This is a mandatory secret; the deployment workflow will fail gracefully if it is missing.*
- `DOCKERHUB_USERNAME` (optional): Your container registry username.
- `DOCKERHUB_TOKEN` (optional): Your container registry password or access token.

## Environment Variables

The application requires the following environment variables to be configured correctly in your deployment environment (e.g., Cloud Run, Docker). These match the runtime validation schema and the `.env.example` template:

- `NODE_ENV`: Defines the environment the application is running in (`development`, `test`, `production`).
- `DATABASE_URL`: Connection string to your production PostgreSQL database. *Required.*
- `POSTGRES_URL_NON_POOLING`: Connection string for the shadow database used by Prisma for migrations, without a connection pooler. *Optional.*
- `ADMIN_PASSWORD`: Cryptographic hash of the administrative password. *Required.*
  - **Format**: Must be an scrypt hash in the format `scrypt:[saltBase64]:[keyBase64]`.
  - **Generation**: Use a standard scrypt generator or the provided `scripts/generate-password-hash.mjs` to create this hash securely. Never store plain text passwords.
- `HISTORY_VERSION_LIMIT`: System limit for the number of history versions to keep for content entries (defaults to 50).

## Connecting to a Hosting Service (e.g., Google Cloud Run)

To deploy your containerized Next.js application to **Google Cloud Run**, follow these steps:

1. **Authenticate with Google Cloud**:
   Add steps to your `deploy.yml` to authenticate using the `google-github-actions/auth` action. Provide your Workload Identity Provider or Service Account Key.

2. **Push to Google Artifact Registry**:
   Update the `docker/build-push-action` in `deploy.yml` to tag and push the image to `us-central1-docker.pkg.dev/YOUR_PROJECT_ID/YOUR_REPO/my-app:latest`.

3. **Deploy to Cloud Run**:
   Add a step at the end of the `deploy.yml` workflow:
   ```yaml
   - name: Deploy to Cloud Run
     uses: google-github-actions/deploy-cloudrun@v1
     with:
       service: my-app-service
       image: us-central1-docker.pkg.dev/YOUR_PROJECT_ID/YOUR_REPO/my-app:latest
       region: us-central1
       env_vars: |
         DATABASE_URL=${{ secrets.DATABASE_URL }}
   ```

## Database Migrations

Database migrations are run automatically using `npx prisma migrate deploy` in the `deploy.yml` workflow *before* the new application code goes live. This ensures zero-downtime compatibility and prevents the new container instances from starting with an outdated schema.

## Multi-platform Builds

The included `Dockerfile` and `deploy.yml` are configured for multi-platform architectures (`linux/amd64` and `linux/arm64`). The build environment includes necessary system-level libraries (`openssl`) to support the application architecture safely across platforms.
