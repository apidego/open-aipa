import { ModelSelect } from '../components/ModelSelect';
import { BotProfileSettings } from '../components/BotProfileSettings';
import { useEffect, useState } from 'react';
import { api, post, type User } from '../api';
import { ErrorMessage, Field, Form, Loading, PageTitle } from '../components/ui';
interface SettingsData {
  model: string;
  complexModel: string;
  taskModel: string;
  systemPrompt: string;
  hasApiKey: boolean;
}
export function Settings({ user }: { user: User }) {
  const [data, setData] = useState<SettingsData>();
  const [error, setError] = useState('');
  const [tested, setTested] = useState('');
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const loadModels = async () => {
    setModelsLoading(true);
    setModelError('');
    try {
      setModels((await api<{ models: string[] }>('/settings/models')).models);
    } catch (e) {
      setModelError((e as Error).message);
    } finally {
      setModelsLoading(false);
    }
  };
  const refresh = () => api<SettingsData>('/settings').then(setData);
  useEffect(() => {
    if (user.role === 'admin') {
      refresh().catch((e) => setError(e.message));
      void loadModels();
    }
  }, []);
  return (
    <>
      <PageTitle
        title="Einstellungen"
        description="Bot-Profil, KI-Modelle und Kontoeinstellungen verwalten."
      />
      <ErrorMessage error={error} />
      <div className="settings-grid">
        {user.role === 'admin' && <BotProfileSettings />}
        {user.role === 'admin' &&
          (!data ? (
            <Loading />
          ) : (
            <section className="card">
              <h3>Assistent</h3>
              <p>Diese Einstellungen gelten für alle Nutzer dieser Installation.</p>
              <Form
                submit={async (form) => {
                  await api('/settings', {
                    method: 'PUT',
                    body: JSON.stringify(Object.fromEntries(form)),
                  });
                  await refresh();
                  await loadModels();
                  setTested('');
                }}
              >
                <ModelSelect
                  label="Normale Konversation"
                  name="model"
                  defaultValue={data.model}
                  models={models}
                />
                <ModelSelect
                  label="Komplexe Sachverhalte"
                  name="complexModel"
                  defaultValue={data.complexModel}
                  models={models}
                />
                <ModelSelect
                  label="Aufgaben und Automatisierungen"
                  name="taskModel"
                  defaultValue={data.taskModel}
                  models={models}
                />
                <div className="model-catalog-status">
                  <small role="status">
                    {modelError ||
                      (modelsLoading
                        ? 'Modelle werden geladen …'
                        : 'Modelle durchsuchen oder eine Modell-ID eingeben.')}
                  </small>
                  <button type="button" disabled={modelsLoading} onClick={() => void loadModels()}>
                    Liste aktualisieren
                  </button>
                </div>
                <p className="small">
                  Normale und komplexe Anfragen werden automatisch zugeordnet. Aufgabenplanung und
                  Ausführung nutzen das Aufgabenmodell.
                </p>
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
                      setTested('API-Key und alle drei Modelle sind erreichbar.');
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
