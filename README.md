# R2-Explorer App

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/r2-explorer-template)

![R2 Explorer Template Preview](https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/e3c4ab7e-43f2-49df-6317-437f4ae8ce00/public)

<!-- dash-content-start -->

R2-Explorer brings a familiar Google Drive-like interface to your Cloudflare R2 storage buckets, making file management simple and intuitive.

## Key Features

- **🔒 Security**
  - Basic Authentication support
  - Cloudflare Access integration
  - Self-hosted on your Cloudflare account

- **📁 File Management**
  - Drag-and-drop file upload
  - Folder creation and organization
  - Multi-part upload for large files
  - Right-click context menu for advanced options
  - HTTP/Custom metadata editing

- **👀 File Handling**
  - In-browser file preview
    - PDF documents
    - Images
    - Text files
    - Markdown
    - CSV
    - Logpush files
  - In-browser file editing
  - Folder upload support

- **📧 Email Integration**
  - Receive and process emails via Cloudflare Email Routing
  - View email attachments directly in the interface

- **🔎 Observability**
  - View real-time logs associated with any deployed Worker using `wrangler tail`
  <!-- dash-content-end -->

> [!IMPORTANT]
> When using C3 to create this project, select "no" when it asks if you want to deploy. You need to follow this project's [setup steps](https://github.com/cloudflare/templates/tree/main/r2-explorer-template#setup-steps) before deploying.

## Authentication

This instance is **not** secured by Cloudflare Access. Instead it reuses the
shared [`auth-service`](https://github.com/frankbracq/geneafan-workers) (WebAuthn
passkey + Email OTP) under the **`geneafan`** tenant, so a single session works
across all genealogie.app apps.

The gate lives in [`src/auth.ts`](src/auth.ts) and runs *in front* of the
r2-explorer handler ([`src/index.ts`](src/index.ts)):

1. Verifies the `__authsvc` session cookie (ES256 JWT) against the tenant JWKS
   at `https://auth.genealogie.app/.well-known/jwks.json`
   (`iss=https://auth.genealogie.app`, `aud=geneafan`).
2. Applies an **admin email allowlist** on top — a valid geneafan session is
   necessary but not sufficient, because the dashboard exposes the whole
   `gedcom-files` bucket. Unauthenticated browser requests are redirected to
   `https://auth.genealogie.app/login?next=…`.

Two prerequisites in `auth-service` (already configured in this repo's companion
change):

- The `geneafan` tenant must list `https://files.genealogie.app` in
  `allowedRedirectOrigins` (`src/tenants.js`) so the post-login redirect back
  here is honoured.
- The cookie is scoped `Domain=.genealogie.app`, so this worker **must** be
  served on a subdomain of `genealogie.app` — here `files.genealogie.app`
  (see the `routes` entry in `wrangler.json`). It will **not** work on a
  `*.workers.dev` URL.

## Setup Steps

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create the R2 bucket (name must match `wrangler.json`):
   ```bash
   npx wrangler r2 bucket create gedcom-files
   ```
3. Set the admin allowlist (comma/space-separated emails):
   ```bash
   echo "fbracq@kotsas.fr" | npx wrangler secret put ADMIN_EMAILS
   ```
4. Make sure `files.genealogie.app` is a custom-domain route on this worker
   (declared in `wrangler.json`) and that the DNS zone is on this Cloudflare
   account.
5. Deploy:
   ```bash
   npx wrangler deploy
   ```
6. Monitor:
   ```bash
   npx wrangler tail
   ```

## Next steps

This instance is **readonly** by default (browse/preview only). To allow
uploads/edits, flip `readonly` to `false` in
[`src/index.ts`](src/index.ts) — but keep the admin allowlist in place.

Consider giving the `preview_bucket_name` in `wrangler.json` a separate bucket
from production so `wrangler dev` doesn't operate on live data.
