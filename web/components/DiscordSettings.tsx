import { useEffect, useState, type FormEvent } from 'react';
import { api, type User } from '../api';
import { ErrorMessage, Loading } from './ui';
interface DiscordData {
  hasBotToken: boolean;
  botName: string;
  botId: string;
  inviteUrl: string;
  botUrl: string;
  discordUserId: string;
  state: 'offline' | 'connecting' | 'online' | 'error';
}
const stateLabel = {
  offline: 'Offline',
  connecting: 'Verbindung wird aufgebaut',
  online: 'Online',
  error: 'Verbindung fehlgeschlagen',
};
export function DiscordSettings({
  user,
  onSaved,
}: {
  user: User;
  onSaved: () => Promise<unknown>;
}) {
  const [data, setData] = useState<DiscordData>(),
    [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [pair, setPair] = useState<{ code: string; expiresAt: number }>(),
    [now, setNow] = useState(Date.now());
  const refresh = () => api<DiscordData>('/integrations/discord/settings').then(setData);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api<DiscordData>('/integrations/discord/settings')
        .then((value) => {
          if (alive) {
            setData(value);
            setNow(Date.now());
            if (value.discordUserId) setPair(undefined);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api('/integrations/discord/settings', {
        method: 'PUT',
        body: JSON.stringify({ botToken: token }),
      });
      setToken('');
      setPair(undefined);
      await refresh();
      await onSaved();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorMessage error={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <p>
            <strong>{data.botName || 'Discord-Bot'}</strong> · {stateLabel[data.state]}
          </p>
          {data.state === 'error' && (
            <p>
              Bot-Token und Internetverbindung prüfen. Der Server versucht die Verbindung erneut.
            </p>
          )}
          {user.role === 'admin' && (
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                <p>
                  Erstelle eine Anwendung im{' '}
                  <a
                    href="https://discord.com/developers/applications"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Discord Developer Portal
                  </a>{' '}
                  und kopiere unter „Bot“ den Bot-Token. Privilegierte Intents werden für
                  Direktnachrichten nicht benötigt.
                </p>
                <label className="field">
                  <span>Bot-Token</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    maxLength={500}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setSaved(false);
                    }}
                    placeholder={
                      data.hasBotToken
                        ? 'Gespeichert · nur zum Ersetzen eingeben'
                        : 'Discord Bot-Token'
                    }
                    required
                  />
                </label>
                <small>
                  Ein neuer Token trennt bestehende Discord-Verknüpfungen aller Nutzer. Der Token
                  wird verschlüsselt gespeichert.
                </small>
                <div className="form-actions">
                  <button className="primary" disabled={!token.trim()}>
                    {busy ? 'Wird geprüft …' : 'Bot speichern'}
                  </button>
                  {saved && (
                    <span role="status" className="success">
                      Gespeichert
                    </span>
                  )}
                </div>
              </fieldset>
            </form>
          )}
          {!data.hasBotToken ? (
            <p>Ein Administrator muss zuerst den Discord-Bot konfigurieren.</p>
          ) : (
            <>
              <hr />
              <h3>Dein Discord-Konto</h3>
              <p>
                Füge den Bot einmal einem eigenen Discord-Server hinzu, damit du ihm
                Direktnachrichten senden kannst. Server-Nachrichten werden ignoriert.
              </p>
              <p>
                <a
                  className="integration-console-link"
                  href={data.inviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Bot zum Server hinzufügen
                </a>{' '}
                ·{' '}
                <a
                  className="integration-console-link"
                  href={data.botUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Bot in Discord öffnen
                </a>
              </p>
              <p>
                Deine Direktnachrichten werden von deinem Agenten verarbeitet, an OpenAI übertragen
                und als Konversation in deinem Dashboard gespeichert. Antworten gehen ausschließlich
                in deinen privaten Chat mit dem Bot.
              </p>
              {data.discordUserId ? (
                <>
                  <p>
                    Verbunden mit Discord-ID <code>{data.discordUserId}</code>.
                  </p>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await api('/integrations/discord', { method: 'DELETE' });
                        setPair(undefined);
                        await refresh();
                        await onSaved();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Discord-Konto trennen
                  </button>
                  <p>
                    <code>!neu</code> beginnt eine neue Konversation. <code>!trennen</code> trennt
                    dein Konto auch direkt in Discord.
                  </p>
                </>
              ) : (
                <>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        setPair(
                          await api('/integrations/discord/pairing', {
                            method: 'POST',
                            body: '{}',
                          }),
                        );
                        setNow(Date.now());
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {pair ? 'Neuen Verbindungscode erstellen' : 'Discord-Konto verknüpfen'}
                  </button>
                  {pair && (
                    <div className="notice">
                      <p>
                        Sende diesen Befehl als Direktnachricht an den Bot. Nicht in einen
                        Server-Kanal posten oder weitergeben.
                      </p>
                      <label className="field">
                        <span>Verbindungsbefehl</span>
                        <input
                          readOnly
                          value={`!verbinden ${pair.code}`}
                          onFocus={(e) => e.target.select()}
                        />
                      </label>
                      <p>
                        {now >= pair.expiresAt
                          ? 'Code abgelaufen. Bitte einen neuen erstellen.'
                          : `Gültig bis ${new Date(pair.expiresAt).toLocaleTimeString('de')}. Nach der Bestätigung kannst du dem Bot direkt schreiben.`}
                      </p>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError('');
                          try {
                            await api('/integrations/discord/pairing', { method: 'DELETE' });
                            setPair(undefined);
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Code widerrufen
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
