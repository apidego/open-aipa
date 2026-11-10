# Integration lifecycle

An administrator activates integrations for the installation before they can be configured or used. Each user then connects their own account. Existing configured/connected Gmail installations are activated once on upgrade; new integrations start inactive.

Deactivation applies to all users and asks for an explicit choice:

- **Keep configuration:** retain encrypted configuration and personal connections. The integration's settings, OAuth flow and tools are blocked until reactivated.
- **Delete configuration:** remove stored provider configuration and every user's connection. Gmail environment credentials are ignored thereafter, including after restart/reactivation; enter fresh credentials in the integration settings to use it again. The application does not modify `.env` or revoke grants at Google. Revoke grants in the provider's account settings if needed.

Pending Gmail OAuth states are cleared on deactivation. Requests already sent to an external service may finish; deactivation cannot recall them. Saved conversations and job history remain. Jobs stay scheduled and fail if they require a disabled integration; activation does not automatically retry failed jobs.
