# Bot profile

Administrators manage the instance-wide assistant name and avatar in Settings → Bot-Profil. Authenticated users see this identity in chat headers and assistant messages. The name is also supplied to the agent. Application branding remains Open AIPA.

Uploads accept static PNG, JPEG or WebP up to 2 MB / 16 megapixels. The server decodes, strips metadata and crops to a 256-pixel PNG. Omitted avatars are preserved; explicit removal restores the default icon.

After an administrator saves a profile, an enabled, configured Discord integration synchronizes username and avatar using Modify Current User. Defaults do not overwrite existing Discord accounts on deployment. Discord may reject names or rate-limit changes. Settings displays pending, synchronized, disabled or error status. Retries respect backoff and stop after three attempts; administrators can retry explicitly. A newly configured bot receives the saved profile. No real Discord account was changed during automated validation.
