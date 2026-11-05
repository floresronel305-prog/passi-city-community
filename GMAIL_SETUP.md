# Gmail password reset setup

The site sends password-reset links through Gmail SMTP using a Google **App Password**. It does not need or accept your regular Gmail password.

1. Turn on 2-Step Verification for the Gmail account used to send messages.
2. Create an App Password in your Google Account security settings.
3. Set these environment variables in the website host's private environment settings (never commit these values):

```sh
GMAIL_USER=your-sender@gmail.com
GMAIL_APP_PASSWORD=your-16-character-app-password
APP_URL=https://your-live-website.example
```

`APP_URL` should be the public HTTPS address of the deployed site. Install dependencies with `npm install`, then start with `npm start`. Reset links expire after 30 minutes and can only be used once. Users can also change their password while signed in from Account settings.

Profile images are restricted to PNG, JPEG, or WebP and 2 MB. They are stored with the app's JSON data file, so use persistent storage and regular backups in production. For multiple users or larger deployments, use a managed database and object storage instead.
