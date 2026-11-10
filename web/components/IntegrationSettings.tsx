import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { X, LoaderCircle, ExternalLink } from 'lucide-react';
import { api, type User } from '../api';
import { DiscordSettings } from './DiscordSettings';
import { ErrorMessage, Loading } from './ui';
import './IntegrationSettings.css';
interface SettingsData {
  clientId: string;
  hasClientSecret: boolean;
  callbackUrl: string;
}
export function IntegrationSettings({
  integration,
  user,
  onClose,
  onSaved,
}: {
  integration: { id: string; name: string; connected: boolean };
  user: User;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState<SettingsData>();
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const editable = user.role === 'admin' && integration.id === 'gmail';
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  useEffect(() => {
    if (!editable) return;
    let alive = true;
    setError('');
    api<SettingsData>(`/integrations/${integration.id}/settings`)
      .then((value) => {
        if (alive) {
          setData(value);
          setClientId(value.clientId);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [integration.id, editable, attempt]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api(`/integrations/${integration.id}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ clientId, clientSecret: secret }),
      });
      setSecret('');
      setData((current) =>
        current
          ? { ...current, clientId, hasClientSecret: !!secret || current.hasClientSecret }
          : current,
      );
      await onSaved();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="integration-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        if (!dialog.current?.open) {
          void onSaved().catch(() => {});
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          event.currentTarget.close();
      }}
    >
      <div className="integration-dialog-heading">
        <h2 id={titleId}>{integration.name}: Einstellungen</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Schließen"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </div>
      <ErrorMessage error={error} />
      {integration.id === 'discord' ? (
        <DiscordSettings user={user} onSaved={onSaved} />
      ) : editable ? (
        !data ? (
          error ? (
            <button onClick={() => setAttempt((value) => value + 1)}>Erneut versuchen</button>
          ) : (
            <Loading />
          )
        ) : (
          <>
            <h3>Google OAuth</h3>
            <p>
              Diese Konfiguration gilt für alle Nutzer der Installation. Erstelle in der Google
              Cloud Console einen OAuth-Client vom Typ „Webanwendung“ und aktiviere die Gmail API.
            </p>
            <p>
              <a
                className="integration-console-link"
                href="https://console.cloud.google.com/auth/clients"
                target="_blank"
                rel="noopener noreferrer"
              >
                OAuth-Clients in Google Cloud öffnen <ExternalLink size={14} aria-hidden="true" />
              </a>
              <br />
              Wähle dort dein Google-Cloud-Projekt aus, um die Client-ID anzusehen oder zu
              erstellen.
            </p>
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                <label className="field">
                  <span>Client-ID</span>
                  <input
                    name="clientId"
                    value={clientId}
                    maxLength={500}
                    onChange={(event) => {
                      setClientId(event.target.value);
                      setSaved(false);
                    }}
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  <span>Client-Secret</span>
                  <input
                    name="clientSecret"
                    type="password"
                    value={secret}
                    maxLength={500}
                    onChange={(event) => {
                      setSecret(event.target.value);
                      setSaved(false);
                    }}
                    autoComplete="new-password"
                    placeholder={
                      data.hasClientSecret
                        ? 'Gespeichert · leer lassen zum Beibehalten'
                        : 'Google Client-Secret'
                    }
                  />
                </label>
                <label className="field">
                  <span>Autorisierte Weiterleitungs-URI</span>
                  <input readOnly value={data.callbackUrl} />
                  <small>
                    Trage exakt diese Adresse im Google OAuth-Client ein. Nach einem Client-Wechsel
                    müssen Nutzer Gmail neu verbinden.
                  </small>
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary">
                    {busy && <LoaderCircle size={16} className="spin" />}
                    {busy ? 'Wird gespeichert …' : 'Speichern'}
                  </button>
                  {saved && (
                    <span role="status" className="success">
                      Gespeichert
                    </span>
                  )}
                </div>
              </fieldset>
            </form>
          </>
        )
      ) : (
        <>
          <p>
            {integration.connected
              ? 'Dein persönliches Konto ist verbunden.'
              : 'Dein persönliches Konto ist nicht verbunden.'}
          </p>
          <p>
            {user.role !== 'admin'
              ? 'Die globale Konfiguration dieser Integration wird von einem Administrator verwaltet.'
              : 'Für diese Integration sind keine weiteren Einstellungen verfügbar.'}
          </p>
        </>
      )}
    </dialog>
  );
}
