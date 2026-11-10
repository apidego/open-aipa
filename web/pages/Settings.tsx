import { useEffect, useState } from 'react';
import { api, post, type User } from '../api';
import { ErrorMessage, Field, Form, Loading, PageTitle } from '../components/ui';
interface SettingsData {
  model: string;
  systemPrompt: string;
  hasApiKey: boolean;
  googleClientId: string;
  hasGoogleSecret: boolean;
  callbackUrl: string;
}
export function Settings({ user }: { user: User }) {
  const [data, setData] = useState<SettingsData>();
  const [error, setError] = useState('');
  const [tested, setTested] = useState('');
  const [testing, setTesting] = useState(false);
  const refresh = () => api<SettingsData>('/settings').then(setData);
  useEffect(() => {
    if (user.role === 'admin') refresh().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageTitle
        title="Einstellungen"
        description="KI-Modell, Integrationen und Kontoeinstellungen verwalten."
      />
      <ErrorMessage error={error} />
      <div className="settings-grid">
        {user.role === 'admin' &&
          (!data ? (
            <Loading />
          ) : (
            <section className="card">
              <h3>Assistent & Integrationen</h3>
              <p>Diese Einstellungen gelten für alle Nutzer dieser Installation.</p>
              <Form
                submit={async (form) => {
                  await api('/settings', {
                    method: 'PUT',
                    body: JSON.stringify(Object.fromEntries(form)),
                  });
                  await refresh();
                  setTested('');
                }}
              >
                <Field label="OpenAI-Modell" name="model" defaultValue={data.model} />
                <Field
                  label="OpenAI API-Key"
                  name="apiKey"
                  type="password"
                  required={false}
                  placeholder={
                    data.hasApiKey ? 'Gespeichert · leer lassen zum Beibehalten' : 'sk-…'
                  }
                />
                <label className="field">
                  <span>System-Prompt</span>
                  <textarea
                    name="systemPrompt"
                    rows={8}
                    defaultValue={data.systemPrompt}
                    required
                    maxLength={20000}
                  />
                  <small>
                    Beschreibt Verhalten und Aufgaben deines PA. Änderungen gelten ab der nächsten
                    Antwort.
                  </small>
                </label>
                <hr />
                <h3>Google OAuth</h3>
                <p>
                  Erstelle in der Google Cloud Console einen OAuth-Client vom Typ „Webanwendung“ und
                  aktiviere die Gmail API.
                </p>
                <Field
                  label="Client-ID"
                  name="googleClientId"
                  defaultValue={data.googleClientId}
                  required={false}
                />
                <Field
                  label="Client-Secret"
                  name="googleClientSecret"
                  type="password"
                  required={false}
                  placeholder={
                    data.hasGoogleSecret
                      ? 'Gespeichert · leer lassen zum Beibehalten'
                      : 'Google Client-Secret'
                  }
                />
                <label className="field">
                  <span>Autorisierte Weiterleitungs-URI</span>
                  <input readOnly value={data.callbackUrl} />
                  <small>
                    Trage exakt diese Adresse im Google OAuth-Client ein. Nach einem Client-Wechsel
                    müssen Nutzer Gmail neu verbinden.
                  </small>
                </label>
              </Form>
              <div className="form-actions">
                <button
                  disabled={testing}
                  onClick={async () => {
                    setTesting(true);
                    setError('');
                    setTested('');
                    try {
                      await api('/settings/test', post({}));
                      setTested('API-Key und Modell sind erreichbar.');
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setTesting(false);
                    }
                  }}
                >
                  {testing ? 'Verbindung wird geprüft …' : 'Gespeicherte OpenAI-Verbindung prüfen'}
                </button>
                <small role="status">{tested}</small>
              </div>
            </section>
          ))}
        <section className="card account-card">
          <h3>Konto</h3>
          <div className="account-avatar">{user.name.slice(0, 1).toUpperCase()}</div>
          <strong>{user.name}</strong>
          <p>{user.email}</p>
          <span className="badge">{user.role === 'admin' ? 'Administrator' : 'Nutzer'}</span>
          <hr />
          <h3>Passwort ändern</h3>
          <Form
            submit={async (form) => {
              await api('/password', post(Object.fromEntries(form)));
            }}
            label="Passwort aktualisieren"
          >
            <Field label="Aktuelles Passwort" name="currentPassword" type="password" />
            <Field
              label="Neues Passwort"
              name="password"
              type="password"
              minLength={12}
              help="Mindestens 12 Zeichen. Andere Sitzungen werden abgemeldet."
            />
          </Form>
        </section>
      </div>
    </>
  );
}
