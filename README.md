# Passi City Community

## Run locally

Requires Node.js 18 or newer. Run `npm start`, then open `http://localhost:3000`.

## Account features

- Members can edit their own name, email, and barangay in **Settings**.
- Password reset is available to signed-in members: enter the current password and choose a new one. Email-based recovery is not enabled because this app has no configured email delivery service.
- Signed-in members can upload a JPEG, PNG, or WebP group/profile picture. The server stores uploads in `uploads/` (or `UPLOAD_DIR`) and account data in `data.json` (or `DATA_FILE`). Keep both persistent and backed up when hosting the app.
- The admin member directory only returns profile and registered-bike information, never passwords or password hashes.

## Configure the administrator

Set `ADMIN_EMAIL` in the server environment to the exact email address of the administrator account, then restart the server. Create/register that account using the same address. Do not rely on a front-end-only admin setting: administrator checks are enforced by the server on every admin API request.

Example:

```sh
ADMIN_EMAIL=admin@example.com npm start
```

Use HTTPS in production and protect access to the server's data and upload directories.
