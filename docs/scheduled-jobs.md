# Scheduled jobs

## Automations and tasks

**Automatisierungen** generate a JavaScript script once when you describe the desired action and schedule. The server later executes the stored script. There is no model call on each run unless you explicitly enable AI access and the script calls `pa.ai`.

**Aufgaben** use the configured AI model and connected tools at execution time. Example: “Prüfe morgen um 10 Uhr mein Gmail-Postfach. Falls eine Mail von XY einen Treffpunkt nennt, benachrichtige mich. Ansonsten sag nichts.” The model can complete silently when the condition is not met. The run remains in the history.

Enter a request and timezone, create a draft, inspect its description and upcoming times, then activate it. Scripts can be expanded for inspection. Drafts never run. Pause/resume and delete are available on existing entries. To change the instruction or schedule, create a new draft and remove or pause the old entry. This version does not edit an active script in place or offer a manual “run now” action.

## Schedules

Supported: one-off dates/times, minute intervals, and recurring clock times/day patterns. Examples: “morgen um 10 Uhr”, “alle 30 Minuten”, “jeden Werktag um 9 Uhr”. The timezone field uses IANA names, such as `Europe/Berlin`. The preview shows up to three upcoming occurrences in the schedule's timezone. If the request is ambiguous, the planner asks for clarification instead of activating a guessed job. Add the missing details to the prompt and generate another draft.

The server checks every 30 seconds. The computer/server must remain running. Recurring missed runs coalesce; overdue one-off jobs run once after the service returns. Runs interrupted by a server restart are marked failed and not replayed. DST transitions are handled by cron-parser; inspect the time preview for schedules near clock changes. Jobs run sequentially, so they may be delayed by earlier work. Pausing does not cancel an in-flight execution.

## Script contract

Scripts are synchronous JavaScript function bodies inside QuickJS/Wasm. The available `pa` object contains:

- `pa.tool(name, args)`: call an explicitly script-enabled, connected integration as the owner. Gmail offers `gmail_search({query})` and `gmail_read({id})` through this generic method. OAuth and credentials stay in the application.
- `pa.ai(prompt)`: call the configured assistant only when “KI-Aufrufe im Skript erlauben” was enabled. This can incur model usage.
- `pa.state`: JSON object from the last successful run, initially `{}`.
- `pa.now`: current ISO timestamp.

Return `{notify, title, message, state}`. `notify=false` records the result without sending a notification. State is saved only after successful execution and result delivery. A sample computation-only script:

```js
return {
  notify: true,
  title: 'Zähler',
  message: `Ausführung ${(pa.state.count || 0) + 1}`,
  state: { count: (pa.state.count || 0) + 1 },
};
```

No shell, Node modules, environment variables, filesystem or arbitrary HTTP access is available. Limits: 16 MiB guest heap, approximately one second CPU, 120 seconds total, 20 capability calls and two AI calls per run. Script source is capped at 30,000 characters; state and result message at 16,000 each. Gmail requests retain their existing timeout and readonly scope. Failed calls/timeouts appear in history; they do not trigger an automatic AI repair or a hidden AI fallback.

## Notifications and future channels

Dashboard notifications are owner-scoped and durable. Marking an item read affects only that account. “Ansonsten sag nichts” suppresses notification delivery, not the execution record. Failures are visible in history. The dashboard refreshes notifications every 15 seconds while open; there is no browser push when the page is closed.

Telegram and Discord are not implemented yet. A request such as “nur über Discord” must be clarified/rejected while that channel is unavailable, never rerouted silently. A separate delivery boundary stores the selected channel so future integrations can be added without changing scheduling or execution.

## Upgrade

Back up the SQLite database and `.env` before upgrading. Migration 2 copies previous AI automations and histories into tasks, keeping ownership, prompts, intervals, pause state and next-run times. The former tables remain as an archive but no longer execute. Existing interval schedules are labeled UTC because they had no wall-clock timezone semantics. New task outcomes use the structured notification contract. Do not downgrade to an old scheduler against the migrated database: it would see the archived rows and could execute them again. Restore a pre-upgrade backup for a rollback.

Model creation/execution uses the existing admin-configured API key/model. Scripts use connected integrations rather than establishing their own connections. Tests mock OpenAI and Gmail; validate account permissions with your own non-sensitive task before relying on a production schedule.

Implementation references: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [QuickJS/Wasm](https://github.com/justjake/quickjs-emscripten), [cron-parser](https://github.com/harrisiirak/cron-parser).
