# Gmail setup

1. Create/select a Google Cloud project and enable the Gmail API.
2. Configure the OAuth consent screen and audience. For a testing application, add your Google account(s) as test users.
3. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients), select your project, and create an OAuth client of type **Web application**. Add the exact authorized redirect URI shown under Open AIPA Integrations → Gmail → gear button, e.g. `http://localhost:3000/api/integrations/gmail/callback` locally or `https://pa.example.com/api/integrations/gmail/callback` remotely.
4. Save the client ID and client secret in the Gmail settings dialog (administrator only). Alternatively configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.
5. Each user opens Integrations → Gmail → Connect and grants read access to their own mailbox.
6. Ask the assistant to search or summarize emails. It can search up to 10 IDs per call, then read individual messages. Text-only bodies are preferred; HTML-only mail falls back to Gmail's snippet. Attachments are not downloaded.

The integration requests only `gmail.readonly`, uses offline access, PKCE and session-bound state, and stores encrypted credentials on your server. Mail can be sent to OpenAI as tool output when your request needs it, including during scheduled tasks. It is not possible to send, delete or modify mail through these tools.

Removing the connection deletes local credentials and disables access in new runs. Existing in-flight calls may finish. To revoke the grant itself, also remove the application's access in your Google Account's third-party connections. Changing the Google OAuth client requires reconnecting accounts.

`gmail.readonly` is a restricted scope. Public OAuth applications may require Google verification and additional review depending on deployment/data use. Testing-mode refresh tokens may expire after seven days. These are Google platform requirements, separate from installing Open AIPA; check the official documentation for your audience and publishing mode.

References: [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [message retrieval](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get), [OpenAI tool calling](https://developers.openai.com/api/docs/guides/tools).
