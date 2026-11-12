# Gmail setup and mail actions

1. Enable the Gmail API in your Google Cloud project and configure the OAuth consent screen/audience. Add your account as a test user while testing.
2. Create a **Web application** OAuth client in [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients). Use the exact redirect URI shown in Integrations → Gmail → settings, e.g. `http://localhost:3000/api/integrations/gmail/callback`.
3. Save the client ID and secret in that dialog (admin only), or set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Each user connects their own Google account. The new grant requests `gmail.modify`: read, send and move mail to trash, without the full-mailbox permanent-delete scope. Existing readonly connections keep working for reads. Use **Berechtigungen erweitern** to reconnect before writes; a failed/declined upgrade leaves the old connection intact.

PKCE, expiring session-bound state, encrypted credentials and owner-scoped access remain mandatory. Google classifies `gmail.modify` as restricted; publishing/verification requirements depend on deployment. Testing-mode refresh tokens may expire after seven days. Mail supplied as tool output can be processed by OpenAI.

## Compose, reply, forward and trash

Use **E-Mails** in the sidebar or ask the assistant in dashboard/Discord chat. Postbox UI search supports Gmail query syntax and returns ten messages. The agent search tool returns up to 25 IDs per page, accepts `pageToken` (null for the first page), includes spam/trash in the searchable scope and exposes `nextPageToken`. It must keep the query unchanged while paging and review all relevant pages/IDs before claiming full coverage. Cleanup searches should exclude existing trash (`-in:trash`). The UI can compose, reply, forward or prepare moving a message to trash. Replies use the source Reply-To/From, original subject, thread ID and References/In-Reply-To headers. Additional recipients can be entered as plain addresses, separated by commas/semicolons. Replies without a valid source Message-ID are rejected.

Forwarding attaches the complete original message as `Original.eml`, including its attachments (maximum 5 MB original). Original Bcc/Resent-Bcc headers are removed to avoid disclosing blind-copy recipients. The preview labels this attachment and shows a text excerpt of the original. This is forwarding as an attachment; newly uploaded attachments and an HTML composer are not implemented. Original HTML-only mail is previewed as Gmail's snippet. Headers/recipients are validated against injection; composed text is UTF-8 MIME encoded.

**Löschen** moves one selected message to the Gmail trash. It does not permanently delete a message or delete a whole thread. Recovery follows Gmail's trash behavior.

## Approval and explicit direct instructions

By default the agent's `gmail_prepare_action` stores an encrypted, immutable local draft and returns a review link. It does not send, modify Gmail drafts or delete anything. Review shows the sender account, all To/Cc/Bcc recipients, subject, body, original/attachment when applicable, and exact planned time. The authenticated owner's origin-checked approval acts on that stored snapshot. Repeated approvals cannot dispatch twice. Editing cancels the old action and creates a fresh preview; scheduled items explicitly offer **Abbrechen und bearbeiten**.

The user requested an exception for explicit direct commands. The server recognizes a deliberately narrow set of imperatives in the **current user request**, e.g. `Sende direkt an anna@example.com`, `Sende ohne Bestätigung an anna@example.com`, `Antworte direkt auf diese Mail`, or `Lösche diese Mail direkt`. Mere urgency (`sofort`), negation, quoted body text, earlier messages and tool/email contents do not grant authorization. Explicit recipients must be present in the instruction; an ordinary reply may use the source Reply-To. Ambiguous phrasing falls back to review. A model-supplied approval flag is rejected. Dispatch result, rather than the assistant's claim, determines whether an action completed.

Mail actions are not exposed to scheduled task execution, script `pa.ai`, or `pa.tool`. Scripts keep only Gmail search/read capabilities. General recurring tasks cannot send arbitrary newly generated mail; this feature schedules an already reviewed message once.

## Scheduled sending and failure handling

Gmail's consumer UI supports scheduled sending; its public REST API does not expose scheduling. Open AIPA therefore stores the reviewed message and exact UTC send instant locally, displaying its chosen IANA timezone in review. The browser composer uses the browser timezone; chat asks for clarification when time/timezone is unclear. Schedules must be within one year. Up to 100 open drafts/queued/sending actions per user are supported.

The single-process worker checks every 30 seconds, at most five mails per tick. The server must run; overdue approved messages are sent on the next available tick after downtime. Cancellation succeeds only before dispatch is claimed. Sending does not call AI again. Tokens are refreshed first; owner binding and configuration are rechecked immediately before claiming and making the Gmail write. Reconnection, disconnect or integration/configuration changes invalidate outstanding actions. Already dispatched requests cannot be recalled.

Statuses distinguish draft, queued, sending, sent, trashed, cancelled, failed-before-dispatch and unknown outcome. Send/trash requests disable transport retries. Network errors or a restart during dispatch result in **Ergebnis unklar** and are never automatically replayed; check Gmail before making another action. This avoids blind duplicate sending but is not exactly-once delivery. Repeated identical tool calls in one agent turn are deduplicated. A new user request is a new action.

Migration 7 adds `mail_actions`; message snapshots (including original EML attachments) and previews are encrypted at rest. History is retained locally until user deletion through account removal or operator retention management; it is not a Gmail draft/scheduled-folder sync. Removing a Gmail connection deletes local credentials, cancels open actions and keeps local history. To revoke the grant itself, also remove the app from your Google Account's third-party connections. No real mail is sent or trashed by automated tests.

Official references: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [sending MIME messages](https://developers.google.com/workspace/gmail/api/guides/sending), [reply threading](https://developers.google.com/workspace/gmail/api/guides/threads), [trash](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/trash), [REST message methods](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages), [Gmail scheduled sending](https://support.google.com/mail/answer/9214606), [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server).
