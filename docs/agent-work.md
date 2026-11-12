# Resumable agent work

Dashboard and Discord conversations no longer abort after five tool rounds. Each invocation can perform up to 24 model rounds and 80 tool calls, with an 85-second soft time budget. A running integration request can finish after this deadline; the outer chat timeout remains 120 seconds. Three consecutive tool errors pause early so missing permissions do not consume the entire budget.

At a boundary or provider interruption, the assistant returns a partial result: confirmed reads, actual mail-action statuses, failures and remaining work. Drafts are explicitly awaiting review and never count as sent or deleted. `weiter`, `mach weiter`, `fortsetzen` or `probier nochmal` in the same conversation resumes the saved original request. Completed pending calls are not replayed; an already completed workflow returns its saved answer. This is user-driven continuation, not an unattended background job.

## Checkpoints and permissions

Migration 8 creates one AES-GCM-encrypted `agent_work` checkpoint per conversation. It includes the original request/time/model/request ID, current model input (including reasoning), pending calls and up to 2,000 receipts. Ownership is checked on every read/write and deletion cascades with the conversation/user. A new unrelated request replaces the checkpoint. Older failed requests from before this feature have no checkpoint: repeat the original request once. There is no cross-conversation continuation or indefinite action journal.

Pending calls are saved before execution and each result is saved before the next call. Gmail's existing action idempotency uses the same request ID across continuations, so a crash after dispatch but before saving its receipt does not blindly dispatch the identical action again. An uncertain Gmail result still requires checking Gmail; this is not an exactly-once guarantee. Current integration access is rechecked per call. Stored work never grants new permission, and changed Gmail binding/configuration invalidates direct-write authorization from the old request. Default previews and approval requirements remain in force.

## Context and limitations

Every six completed model rounds, or at 80% of the input budget, the worker compresses its history with the active scenario model. This adds API usage. It never compacts while function results are pending. The original request, exact recent search queries/cursors, recently processed IDs and a bounded queue of discovered unread IDs remain alongside the summary. Summary failure falls back to receipts. Summaries are fallible, untrusted historical data; omitted steps are not evidence that they were never performed. Receipt retention and context are bounded; partial results explicitly disclose when old receipts were dropped.

Gmail searches accept pagination and return up to 25 IDs per page. A first-page result is not a complete mailbox review. Bulk cleanup should collect IDs before mutating the mailbox and recheck coverage after mutations. Search/read/action errors remain visible, and drafts, queued sends, confirmed writes and unknown outcomes are distinct.

Scheduled tasks and script AI share the expanded execution budget but do not save resumable conversation work. Incomplete execution fails rather than producing a success notification. They still cannot invoke Gmail write tools. Automated tests mock OpenAI, Gmail and Discord; no real mailbox cleanup is performed for validation.

References: [OpenAI function calling and reasoning items](https://developers.openai.com/api/docs/guides/function-calling), [conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [Gmail message pagination](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).
