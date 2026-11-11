import { OAuth2Client } from 'google-auth-library';
import type { Context } from '../core/context.js';
import { HttpError } from '../core/http.js';
import { gmailSettings, requireIntegration, integrationEnabled } from './state.js';
export function googleClient(ctx: Context) {
  requireIntegration(ctx, 'gmail');
  const { clientId: id, encryptedSecret, envSecret } = gmailSettings(ctx);
  const secret = encryptedSecret ? ctx.vault.open(encryptedSecret) : envSecret;
  if (!id || !secret)
    throw new HttpError(400, 'Bitte zuerst Google OAuth in den Einstellungen konfigurieren.');
  return new OAuth2Client({
    clientId: id,
    clientSecret: secret,
    redirectUri: `${ctx.config.url}/api/integrations/gmail/callback`,
  });
}
export async function clientFor(ctx: Context, userId: string) {
  const row = ctx.store.get<{ credentials: string }>(
    'SELECT credentials FROM connections WHERE user_id=? AND provider=?',
    userId,
    'gmail',
  );
  if (!row) throw new HttpError(400, 'Gmail ist nicht verbunden.');
  const client = googleClient(ctx);
  const generation = ctx.store.setting('gmailGeneration');
  client.setCredentials(JSON.parse(ctx.vault.open(row.credentials)));
  client.on('tokens', (tokens) => {
    const latest = ctx.store.get<{ credentials: string }>(
      'SELECT credentials FROM connections WHERE user_id=? AND provider=?',
      userId,
      'gmail',
    );
    if (
      latest &&
      latest.credentials === row.credentials &&
      integrationEnabled(ctx, 'gmail') &&
      ctx.store.setting('gmailGeneration') === generation
    )
      ctx.store.run(
        'UPDATE connections SET credentials=? WHERE user_id=? AND provider=?',
        ctx.vault.seal(
          JSON.stringify({ ...JSON.parse(ctx.vault.open(latest.credentials)), ...tokens }),
        ),
        userId,
        'gmail',
      );
  });
  return client;
}
export interface MailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: MailPart[];
}
export function textParts(part?: MailPart): string {
  if (!part) return '';
  const own =
    part.mimeType === 'text/plain' && part.body?.data
      ? Buffer.from(part.body.data, 'base64url').toString('utf8')
      : '';
  return [own, ...(part.parts || []).map(textParts)].filter(Boolean).join('\n');
}
