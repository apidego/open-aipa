# Scenario models

Administrators select three model IDs in Settings using searchable dropdowns populated from the stored OpenAI key's model list:

- Normal conversation: everyday dashboard and Discord replies, plus conversation-history compaction.
- Complex requests: demanding conversational reasoning, debugging, synthesis and tradeoffs.
- Tasks and automations: draft planning, scheduled AI task execution, and explicitly permitted `pa.ai` calls inside scripts. Scripts without AI permission do not invoke a model.

Existing installations use the former `model` setting for all scenarios until separate selections are saved. The normal model remains in `model`; `complexModel` and `taskModel` override it. Saving or fetching settings and listing/testing models is admin-only. No key is returned to the browser.

## Automatic conversation routing

If normal and complex IDs differ, one bounded `POST /v1/decisions` request with `gpt-6-luna` selects between them before generation. It receives bounded excerpts of the six latest messages (including the current question), never arbitrary recipients or a model ID to execute. An ordinary choice with confidence at least 0.7 uses the normal model; complex, uncertain, refused, malformed, timed-out or unavailable decisions use the configured complex model. Caller cancellation still aborts the turn. The five-second routing timeout bounds the added wait. No routing call is made for identical models or for task/script execution.

The chosen response model is pinned across all tool rounds of one answer. Task calls always use the task model; the classifier cannot redirect them. The confidence threshold is an initial policy, not a claim of measured routing accuracy; evaluate real examples before tuning it. Conversation compaction uses the normal model regardless of the eventual answer route.

## Catalog and validation limits

The model-list endpoint does not advertise capabilities. We filter obvious non-text/specialized models and retain saved IDs, but this is not a compatibility certification. Administrators can type a model ID directly for newer/project-specific models. Choose models supporting Responses, function calls and structured outputs; the connection check verifies access to all selected IDs, not their behavior. Provider errors do not expose credentials or response bodies. Changing API keys requires saving before refreshing the list.

Official references: [Models list](https://developers.openai.com/api/reference/resources/models/methods/list), [model catalog](https://developers.openai.com/api/docs/models), [Decisions](https://developers.openai.com/api/docs/guides/decisions). The installed SDK does not expose Decisions, so the small routing adapter calls the documented endpoint directly without replacing the SDK.
