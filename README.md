# Passi City Community

## Account settings and password reset email

The site includes signed-in account settings to edit a member's name and barangay, upload/remove a profile photo, and change a password. The login form includes a **Forgot password?** flow. Reset links are single-use and expire after 30 minutes.

To enable password-reset email delivery through Gmail, install the dependency (`npm install`) and configure these environment variables on the server/hosting provider:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=465`
- `SMTP_USER=your Gmail address`
- `SMTP_PASS=your Google App Password` (not your normal Gmail password)
- `APP_URL=https://your-live-site.example` (the public base URL of this website)
- Optional: `SMTP_FROM=Passi City Community <your Gmail address>`

For Gmail, turn on 2-Step Verification on the Google account and create an App Password in Google Account security settings. Store it as a private environment secret in your hosting provider; never commit it to this repository or share it in chat. If email variables are missing, the UI will explain that recovery email has not been configured yet.

After adding the environment variables, restart/redeploy the Node server. Photo uploads are resized in the browser and stored with the account data file, so keep that file persistent and backed up on the host. A deployment that serves only static files (for example, GitHub Pages) cannot run this Node API or send the reset emails; deploy the app on a Node.js host for these features.
