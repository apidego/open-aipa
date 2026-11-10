import type { Context } from '../core/context.js';
import { HttpError } from '../core/http.js';
export const enabledKey = (id: string) => `integration:${id}:enabled`;
export function integrationEnabled(ctx: Context, id: string) {
  return ctx.store.setting(enabledKey(id)) === 'true';
}
export function requireIntegration(ctx: Context, id: string) {
  if (!integrationEnabled(ctx, id)) throw new HttpError(409, 'Integration zuerst aktivieren.');
}
export function gmailSettings(ctx: Context) {
  const useEnv = ctx.store.setting('integration:gmail:ignoreEnv') !== 'true';
  return {
    clientId: ctx.store.setting('googleClientId') || (useEnv ? ctx.config.googleClientId : ''),
    encryptedSecret: ctx.store.setting('googleClientSecret'),
    envSecret: useEnv ? ctx.config.googleClientSecret : '',
  };
}
