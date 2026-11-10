import type { Context } from '../core/context.js';
import type { SendReply } from './discord-channel.js';
import { discordLink } from '../modules/jobs/notifications.js';
interface Delivery {
  run_id: string;
  user_id: string;
  link_id: string;
  channel_id: string;
  generation: string;
  title: string;
  message: string;
  created_at: number;
}
// Single-process outbox: claim before sending; uncertain sends are never replayed automatically.
export function discordDelivery(ctx: Context, send: SendReply, ready: () => boolean) {
  const { store } = ctx;
  store.run(
    "UPDATE discord_deliveries SET status='failed',error='Zustellung durch Neustart unterbrochen; Versandstatus unklar. Kein automatischer Neuversand.' WHERE status='sending'",
  );
  let pending: Promise<void> | undefined;
  const drain = async () => {
    const rows = store.all<Delivery>(
      "SELECT d.*,j.user_id FROM discord_deliveries d JOIN job_runs r ON r.id=d.run_id JOIN jobs j ON j.id=r.job_id WHERE d.status='pending' ORDER BY d.created_at LIMIT 20",
    );
    for (const row of rows) {
      const valid = () => {
        const link = discordLink(ctx, row.user_id);
        return (
          !!link &&
          link.id === row.link_id &&
          link.channel_id === row.channel_id &&
          row.generation === store.setting('discordGeneration') &&
          !!store.get('SELECT run_id FROM discord_deliveries WHERE run_id=?', row.run_id)
        );
      };
      const fail = (error: string) =>
        store.run(
          "UPDATE discord_deliveries SET status='failed',error=? WHERE run_id=?",
          error,
          row.run_id,
        );
      if (!valid()) {
        fail('Discord-Verknüpfung fehlt oder wurde geändert. Keine Umleitung ins Dashboard.');
        continue;
      }
      if (Date.now() - row.created_at > 86400000) {
        fail('Discord war länger als 24 Stunden nicht erreichbar.');
        continue;
      }
      if (!ready()) continue;
      if (
        !store.run(
          "UPDATE discord_deliveries SET status='sending' WHERE run_id=? AND status='pending'",
          row.run_id,
        ).changes
      )
        continue;
      try {
        const content = row.title + '\n\n' + row.message;
        for (let offset = 0; offset < content.length; offset += 1900) {
          if (!valid() || !ready()) throw new Error();
          await send(
            row.channel_id,
            content.slice(offset, offset + 1900),
            () => valid() && ready(),
          );
          if (!valid() || !ready()) throw new Error();
        }
        store.run(
          "UPDATE discord_deliveries SET status='sent',error=NULL WHERE run_id=?",
          row.run_id,
        );
        store.run('UPDATE job_runs SET notified=1 WHERE id=?', row.run_id);
      } catch {
        fail(
          'Discord-Zustellung fehlgeschlagen oder unklar. Möglich sind bereits gesendete Teile; kein automatischer Neuversand.',
        );
      }
    }
  };
  const tick = () => {
    if (pending) return pending;
    pending = drain().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  return Object.assign(tick, { idle: () => pending || Promise.resolve() });
}
