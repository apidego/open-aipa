# Security

This is an early MVP, not an independently audited product. Use a trusted single-host deployment, TLS for remote access, private backups and an API key with a suitable budget. Keep dependencies current.

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/apidego/open-aipa/security/advisories/new), not a public issue. Include reproduction steps and affected versions, without credentials or private mail. If private reporting is unavailable, open a minimal issue requesting a private contact without disclosing exploit details.

Existing controls include one-time setup authorization, salted scrypt passwords, hashed session tokens, session invalidation, origin validation on writes, API/login rate limits, user-scoped data access, encrypted API/OAuth credentials, session-bound OAuth state and PKCE, bounded tool execution and read-only Gmail scopes.

Limitations: server operators can access local data, chat/result content is not encrypted at the application layer, LLM output and email text are untrusted, automated tasks can incur API costs, and there is no MFA, external identity provider, recovery-email flow or distributed rate limiter yet. Do not add arbitrary execution or external write tools without a separate permission and isolation design.
