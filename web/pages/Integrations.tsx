import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, ExternalLink, Plug, ShieldCheck, Settings } from 'lucide-react';
import { api, post, type User } from '../api';
import { ErrorMessage, Loading, PageTitle } from '../components/ui';
import { DeactivateIntegration } from '../components/DeactivateIntegration';
import { IntegrationSettings } from '../components/IntegrationSettings';
interface Integration {
  id: string;
  name: string;
  description: string;
  connected: boolean;
  configured: boolean;
  enabled: boolean;
}
export function Integrations({ user }: { user: User }) {
  const [items, setItems] = useState<Integration[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Integration>();
  const [deactivate, setDeactivate] = useState<Integration>();
  const [params] = useSearchParams();
  const refresh = () => api<Integration[]>('/integrations').then(setItems);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    if (params.has('error'))
      setError(
        'Google-Verbindung nicht abgeschlossen. Bitte erneut verbinden und den Zugriff auf Gmail erlauben.',
      );
  }, []);
  return (
    <>
      <PageTitle
        title="Integrationen"
        description="Verbundene Dienste und Zugriffsberechtigungen verwalten."
      />
      <ErrorMessage error={error} />
      {params.has('connected') && (
        <div className="notice success" role="status">
          Gmail wurde erfolgreich verbunden.
        </div>
      )}
      {!items ? (
        <Loading />
      ) : (
        <div className="integration-grid">
          {items.map((item) => (
            <section className="card integration-card" key={item.id}>
              <div className="card-heading">
                <span className="gmail-logo">M</span>
                <div className="integration-card-actions">
                  <span className={`badge ${item.connected ? 'connected' : ''}`}>
                    {!item.enabled ? (
                      'Deaktiviert'
                    ) : item.connected ? (
                      <>
                        <Check size={12} />
                        Verbunden
                      </>
                    ) : (
                      'Nicht verbunden'
                    )}
                  </span>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`${item.name}: Einstellungen`}
                    title={item.enabled ? 'Einstellungen' : 'Zuerst aktivieren'}
                    disabled={!item.enabled}
                    onClick={() => setSelected(item)}
                  >
                    <Settings size={18} />
                  </button>
                </div>
              </div>
              <h2>{item.name}</h2>
              <p>{item.description}</p>
              {!item.enabled ? (
                user.role === 'admin' ? (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await api(`/integrations/${item.id}/activation`, {
                          method: 'PUT',
                          body: JSON.stringify({ enabled: true }),
                        });
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Aktivieren
                  </button>
                ) : (
                  <p>Ein Administrator muss diese Integration zuerst aktivieren.</p>
                )
              ) : (
                <>
                  <div className="permission">
                    <ShieldCheck size={16} />
                    <span>Lesender Zugriff · Nur dein persönliches Konto</span>
                  </div>
                  <p className="small">
                    Dein PA kann bei passenden Aufträgen E-Mails lesen und deren Inhalt an OpenAI
                    zur Verarbeitung übertragen.
                  </p>
                  {!item.configured ? (
                    <div className="notice">
                      {user.role === 'admin' ? (
                        <button type="button" onClick={() => setSelected(item)}>
                          Google OAuth einrichten
                        </button>
                      ) : (
                        'Dein Administrator muss zuerst Google OAuth einrichten.'
                      )}
                    </div>
                  ) : (
                    <button
                      className={item.connected ? '' : 'primary'}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          if (item.connected) {
                            await api(`/integrations/${item.id}`, { method: 'DELETE' });
                            await refresh();
                          } else {
                            const result = await api(`/integrations/${item.id}/connect`, post({}));
                            window.location.assign(result.url);
                          }
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {busy
                        ? 'Bitte warten …'
                        : item.connected
                          ? 'Verbindung entfernen'
                          : 'Mit Gmail verbinden'}
                      <Plug size={15} />
                    </button>
                  )}
                  <small>
                    Beim Entfernen werden lokale Tokens gelöscht. Den Google-Zugriff kannst du
                    zusätzlich in deinem Google-Konto widerrufen.
                  </small>
                  {user.role === 'admin' && (
                    <button
                      className="integration-deactivate"
                      disabled={busy}
                      onClick={() => setDeactivate(item)}
                    >
                      Deaktivieren
                    </button>
                  )}
                </>
              )}
            </section>
          ))}
          <section className="integration-placeholder">
            <Plug size={25} strokeWidth={1.3} />
            <h3>Weitere Integrationen</h3>
            <p>Weitere Dienste lassen sich über das modulare Integrationssystem ergänzen.</p>
            <a
              href="https://github.com/apidego/open-aipa/issues/new?template=feature.yml"
              target="_blank"
              rel="noreferrer"
            >
              Integration vorschlagen
              <ExternalLink size={14} />
            </a>
          </section>
        </div>
      )}
      {deactivate && (
        <DeactivateIntegration
          id={deactivate.id}
          name={deactivate.name}
          onClose={() => setDeactivate(undefined)}
          onSaved={refresh}
        />
      )}
      {selected && (
        <IntegrationSettings
          integration={selected}
          user={user}
          onClose={() => setSelected(undefined)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
