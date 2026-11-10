import { useState } from 'react';
import { ArrowRight, Check, ShieldCheck, KeyRound, UserRound, Eye, EyeOff } from 'lucide-react';
import './Access.css';
import { api, post } from '../api';
import { Brand, ErrorMessage, Field, Form } from '../components/ui';
export function Access({ setup, reload }: { setup: boolean; reload: () => Promise<void> }) {
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const labels = ['Installation verbinden', 'Admin erstellen', 'Assistent einrichten'];
  return (
    <main className={`access${setup ? '' : ' access-login'}`}>
      <section className="access-story">
        <div className="wordmark">
          <Brand />
          Open AIPA
          <span className="access-context">{setup ? 'EINRICHTUNG' : 'ANMELDUNG'}</span>
        </div>
        <div>
          <h1>Open AIPA</h1>
          <p>Konversationen, Integrationen, Automatisierungen und Aufgaben verwalten.</p>
          {setup ? (
            <div className="story-orbit">
              <div className="orbit-inner">
                <Brand />
              </div>
              <span className="orbit-label one">Konversationen</span>
              <span className="orbit-label two">Integrationen</span>
              <span className="orbit-label three">Automatisierungen</span>
            </div>
          ) : (
            <ul className="access-benefits">
              {[
                'Konversationen mit KI',
                'Verbundene Integrationen',
                'Skripte und geplante Aufgaben',
                'Ergebnisse und Benachrichtigungen',
              ].map((benefit) => (
                <li key={benefit}>
                  <Check size={23} strokeWidth={2.5} aria-hidden="true" />
                  {benefit}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="access-form">
        <div className="access-card">
          <h2>{setup ? 'Einrichtung' : 'Anmelden'}</h2>
          <p>
            {setup
              ? 'Installation verbinden, Administratorkonto erstellen und OpenAI konfigurieren.'
              : 'Melde dich an, um zu deinem Arbeitsbereich zu gelangen.'}
          </p>
          {setup ? (
            <>
              <ol className="steps">
                {labels.map((label, i) => (
                  <li key={label} className={i === step ? 'current' : i < step ? 'complete' : ''}>
                    <span>{i < step ? <Check size={13} /> : i + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const data = {
                    ...values,
                    ...Object.fromEntries(new FormData(e.currentTarget)),
                  } as Record<string, string>;
                  setValues(data);
                  if (step < 2) {
                    setStep(step + 1);
                    return;
                  }
                  setError('');
                  const button =
                    e.currentTarget.querySelector<HTMLButtonElement>('button[type=submit]')!;
                  button.disabled = true;
                  try {
                    await api('/setup', post(data));
                    await reload();
                  } catch (err) {
                    setError((err as Error).message);
                    button.disabled = false;
                  }
                }}
              >
                {step === 0 && (
                  <div className="wizard-step">
                    <ShieldCheck size={24} />
                    <h3>Installation verbinden</h3>
                    <p>
                      Gib den Einrichtungsschlüssel aus dem Installationsprogramm ein. Er schützt
                      die erstmalige Einrichtung.
                    </p>
                    <Field
                      label="Einrichtungsschlüssel"
                      name="setupToken"
                      type="password"
                      defaultValue={values.setupToken}
                      minLength={32}
                    />
                    <small>Du findest ihn auch als SETUP_TOKEN in deiner .env-Datei.</small>
                  </div>
                )}
                {step === 1 && (
                  <div className="wizard-step">
                    <UserRound size={24} />
                    <h3>Administratorkonto</h3>
                    <Field label="Name" name="name" defaultValue={values.name} />
                    <Field label="E-Mail" name="email" type="email" defaultValue={values.email} />
                    <Field
                      label="Passwort"
                      name="password"
                      type="password"
                      minLength={12}
                      defaultValue={values.password}
                      help="Mindestens 12 Zeichen. Weitere Nutzer legst du später im Dashboard an."
                    />
                  </div>
                )}
                {step === 2 && (
                  <div className="wizard-step">
                    <KeyRound size={24} />
                    <h3>Mit OpenAI verbinden</h3>
                    <Field
                      label="OpenAI API-Key"
                      name="apiKey"
                      type="password"
                      minLength={10}
                      defaultValue={values.apiKey}
                      placeholder="sk-…"
                    />
                    <Field
                      label="Modell"
                      name="model"
                      defaultValue={values.model || 'gpt-5.4-mini'}
                      help="Verwende ein Responses-API-Modell, auf das dein OpenAI-Projekt Zugriff hat."
                    />
                    <p className="notice">
                      Chat-Inhalte und angefragte Gmail-Inhalte werden zur Verarbeitung an OpenAI
                      übertragen. API-Nutzung wird über dein OpenAI-Konto abgerechnet.
                    </p>
                  </div>
                )}
                <ErrorMessage error={error} />
                <div className="form-actions">
                  {step > 0 && (
                    <button type="button" onClick={() => setStep(step - 1)}>
                      Zurück
                    </button>
                  )}
                  <button className="primary" type="submit">
                    {step < 2 ? 'Weiter' : 'Workspace erstellen'}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <Form
              label="Anmelden"
              submit={async (data) => {
                await api('/login', post(Object.fromEntries(data)));
                await reload();
              }}
            >
              <label className="field" htmlFor="login-email">
                <span>E-Mail</span>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                />
              </label>
              <div className="field">
                <label htmlFor="login-password">Passwort</label>
                <div className="access-password">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    maxLength={500}
                  />
                  <button
                    type="button"
                    className="access-password-toggle"
                    aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                    aria-pressed={showPassword}
                    aria-controls="login-password"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff size={18} aria-hidden="true" />
                    ) : (
                      <Eye size={18} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            </Form>
          )}
          <small className="access-footer">
            {setup
              ? 'Der API-Key wird auf deinem Server verschlüsselt gespeichert.'
              : 'Kein Account? Dein Administrator kann dich im Dashboard hinzufügen.'}
          </small>
        </div>
      </section>
    </main>
  );
}
