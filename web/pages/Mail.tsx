import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { MailPlus, Search, ArrowLeft, Clock, Send, Trash2, X } from 'lucide-react';
import { api, post } from '../api';
import { ErrorMessage, PageTitle, Loading } from '../components/ui';
import { ServiceIcon } from '../components/ServiceIcon';
import './Mail.css';
type Kind = 'compose' | 'reply' | 'forward' | 'trash';
interface Message {
  id: string;
  subject: string;
  from: string;
  date: string;
  text: string;
}
interface Payload {
  kind: Kind;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  sourceId: string | null;
  sendAt: string | null;
  timezone: string;
  from: string;
  sourceSubject?: string;
  sourceFrom?: string;
  originalText?: string;
  originalAttached?: boolean;
}
interface Action {
  id: string;
  status: string;
  createdAt: number;
  error: string | null;
  mail: Payload;
  authorization: string | null;
}
const labels: Record<string, string> = {
  draft: 'Freigabe ausstehend',
  queued: 'Versand geplant',
  sending: 'Wird ausgeführt',
  sent: 'Gesendet',
  trashed: 'Im Papierkorb',
  cancelled: 'Abgebrochen',
  failed: 'Nicht ausgeführt',
  unknown: 'Ergebnis unklar',
};
const verbs: Record<Kind, string> = {
  compose: 'Neue E-Mail',
  reply: 'Antwort',
  forward: 'Weiterleitung',
  trash: 'In den Papierkorb',
};
const addresses = (value: string) =>
  value
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const localStamp = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function Mail() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Action[]>(),
    [access, setAccess] = useState<{ connected: boolean; canWrite: boolean }>();
  const [selected, setSelected] = useState<Action>(),
    [source, setSource] = useState<Message>();
  const [initial, setInitial] = useState<Payload>();
  const [kind, setKind] = useState<Kind>('compose'),
    [editing, setEditing] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState('in:inbox');
  const [results, setResults] = useState<Message[]>(),
    [schedule, setSchedule] = useState(false);
  const refresh = async () => {
    const [list, grant] = await Promise.all([
      api<Action[]>('/mail'),
      api<{ connected: boolean; canWrite: boolean }>('/mail/access'),
    ]);
    setItems(list);
    setAccess(grant);
    return list;
  };
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const list = await refresh();
        const id = params.get('id');
        if (id) {
          const item = list.find((a) => a.id === id) || (await api<Action>(`/mail/${id}`));
          if (active) setSelected(item);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [params.get('id')]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const show = (item: Action) => {
    setSelected(item);
    setEditing(false);
    setParams({ id: item.id });
  };
  const compose = (next: Kind = 'compose', mail?: Message, previous?: Payload) => {
    setInitial(previous);
    setKind(next);
    setSource(mail);
    setSelected(undefined);
    setEditing(true);
    setSchedule(!!previous?.sendAt);
    setParams({});
    setError('');
  };
  const prepare = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const at = String(data.get('sendAt') || '');
    if (schedule && (!at || !Number.isFinite(new Date(at).getTime())))
      throw new Error('Bitte einen gültigen Versandzeitpunkt wählen.');
    if (schedule && localStamp(new Date(at)) !== at.slice(0, 16))
      throw new Error(
        'Diese Uhrzeit existiert in deiner Zeitzone nicht. Bitte einen anderen Zeitpunkt wählen.',
      );
    const draft = await api<Action>(
      '/mail',
      post({
        kind,
        to: addresses(String(data.get('to') || '')),
        cc: addresses(String(data.get('cc') || '')),
        bcc: addresses(String(data.get('bcc') || '')),
        subject: String(data.get('subject') || ''),
        body: String(data.get('body') || ''),
        sourceId: source?.id || null,
        sendAt: schedule && at ? new Date(at).toISOString() : null,
        timezone: zone(),
      }),
    );
    await refresh();
    show(draft);
  };
  return (
    <>
      <PageTitle
        title="E-Mails"
        description="Nachrichten verfassen, prüfen und den Versand planen."
        action={
          <button
            className="primary"
            disabled={!access?.canWrite || busy}
            onClick={() => compose()}
          >
            <MailPlus size={17} />
            Neue E-Mail
          </button>
        }
      />
      <ErrorMessage error={error} />
      {access && !access.canWrite && (
        <div className="notice mail-access">
          <span>
            {access.connected
              ? 'Für Versand und Löschen benötigt Gmail deine erweiterten Berechtigungen.'
              : 'Verbinde dein Gmail-Konto, um E-Mails zu verwalten.'}
          </span>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const response = await api('/integrations/gmail/connect', post({}));
                window.location.assign(response.url);
              })
            }
          >
            {access.connected ? 'Berechtigungen erweitern' : 'Mit Gmail verbinden'}
          </button>
          <Link to="/integrations">Integrationen</Link>
        </div>
      )}
      <div className="mail-grid">
        <div className="mail-overview">
          <section className="card">
            <div className="card-heading">
              <h3>Entwürfe und Versand</h3>
              <ServiceIcon service="gmail" />
            </div>
            {!items ? (
              <Loading />
            ) : !items.length ? (
              <p>Noch keine Mail-Aktionen.</p>
            ) : (
              <div className="mail-list">
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={selected?.id === item.id ? 'selected' : ''}
                    onClick={() => show(item)}
                  >
                    <strong>{item.mail.subject || '(Kein Betreff)'}</strong>
                    <span>
                      {verbs[item.mail.kind]} · {labels[item.status]}
                    </span>
                    {item.mail.sendAt && (
                      <small>
                        {new Date(item.mail.sendAt).toLocaleString('de-DE', {
                          timeZone: item.mail.timezone,
                        })}{' '}
                        · {item.mail.timezone}
                      </small>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="card">
            <h3>Im Postfach suchen</h3>
            <form
              className="mail-search"
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () =>
                  setResults(
                    await api<Message[]>(`/mail/messages/search?q=${encodeURIComponent(query)}`),
                  ),
                );
              }}
            >
              <input
                aria-label="Gmail durchsuchen"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={500}
                placeholder="Absender, Betreff oder Gmail-Suchbegriff"
              />
              <button aria-label="Suchen" disabled={busy || !access?.connected}>
                <Search size={18} />
              </button>
            </form>
            {results && (
              <div className="mail-list">
                {results.length ? (
                  results.map((mail) => (
                    <button
                      key={mail.id}
                      onClick={() =>
                        void action(async () => {
                          setSource(await api<Message>(`/mail/messages/${mail.id}`));
                          setSelected(undefined);
                          setEditing(false);
                          setParams({});
                        })
                      }
                    >
                      <strong>{mail.subject || '(Kein Betreff)'}</strong>
                      <span>{mail.from}</span>
                    </button>
                  ))
                ) : (
                  <p>Keine passenden Mails.</p>
                )}
              </div>
            )}
          </section>
        </div>
        <section className="card mail-detail">
          {editing ? (
            <form
              key={kind + source?.id}
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                void action(() => prepare(form));
              }}
            >
              <h3>{verbs[kind]}</h3>
              {source && (
                <p className="small">
                  {source.subject} · {source.from}
                </p>
              )}
              {kind === 'trash' ? (
                <>
                  <p>Diese Mail wird nach deiner Freigabe in den Gmail-Papierkorb verschoben.</p>
                  <pre className="mail-body">{source?.text}</pre>
                </>
              ) : (
                <>
                  <label className="field">
                    An
                    <input
                      name="to"
                      defaultValue={initial?.to.join(', ')}
                      placeholder={
                        kind === 'reply'
                          ? 'Leer lassen: Antwort an den ursprünglichen Absender'
                          : 'name@example.com'
                      }
                      maxLength={2000}
                    />
                  </label>
                  <div className="mail-addresses">
                    <label className="field">
                      Cc
                      <input name="cc" defaultValue={initial?.cc.join(', ')} maxLength={2000} />
                    </label>
                    <label className="field">
                      Bcc
                      <input name="bcc" defaultValue={initial?.bcc.join(', ')} maxLength={2000} />
                    </label>
                  </div>
                  <label className="field">
                    Betreff
                    <input
                      name="subject"
                      maxLength={250}
                      readOnly={kind === 'reply'}
                      defaultValue={
                        initial?.subject ??
                        (kind === 'reply'
                          ? source?.subject
                          : kind === 'forward'
                            ? 'Fwd: ' + source?.subject
                            : '')
                      }
                    />
                  </label>
                  <div className="field">
                    <label htmlFor="mail-body">Nachricht</label>
                    <textarea
                      id="mail-body"
                      name="body"
                      defaultValue={initial?.body}
                      rows={10}
                      required={kind !== 'forward'}
                      maxLength={20000}
                    />
                  </div>
                  {kind === 'forward' && (
                    <p className="small">
                      Die vollständige Originalmail einschließlich ihrer Anhänge wird als
                      „Original.eml“ beigefügt (maximal 5 MB).
                    </p>
                  )}
                  <label className="mail-schedule-toggle">
                    <input
                      type="checkbox"
                      checked={schedule}
                      onChange={(e) => setSchedule(e.target.checked)}
                    />
                    Versand planen
                  </label>
                  {schedule && (
                    <label className="field">
                      Versandzeitpunkt · {zone()}
                      <input
                        name="sendAt"
                        type="datetime-local"
                        defaultValue={
                          initial?.sendAt
                            ? new Date(
                                Date.parse(initial.sendAt) -
                                  new Date(initial.sendAt).getTimezoneOffset() * 60000,
                              )
                                .toISOString()
                                .slice(0, 16)
                            : undefined
                        }
                        required
                      />
                    </label>
                  )}
                </>
              )}
              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  {busy ? 'Wird vorbereitet …' : 'Vorschau erstellen'}
                </button>
                <button type="button" onClick={() => setEditing(false)} disabled={busy}>
                  Abbrechen
                </button>
              </div>
            </form>
          ) : selected ? (
            <>
              <div className="card-heading">
                <h3>{verbs[selected.mail.kind]}</h3>
                <span className="badge">{labels[selected.status]}</span>
              </div>
              <h2>{selected.mail.subject || '(Kein Betreff)'}</h2>
              <dl className="mail-meta">
                <dt>Von</dt>
                <dd>{selected.mail.from}</dd>
                {selected.mail.to.length > 0 && (
                  <>
                    <dt>An</dt>
                    <dd>{selected.mail.to.join(', ')}</dd>
                  </>
                )}
                {selected.mail.cc.length > 0 && (
                  <>
                    <dt>Cc</dt>
                    <dd>{selected.mail.cc.join(', ')}</dd>
                  </>
                )}
                {selected.mail.bcc.length > 0 && (
                  <>
                    <dt>Bcc</dt>
                    <dd>{selected.mail.bcc.join(', ')}</dd>
                  </>
                )}
                <dt>{selected.mail.kind === 'trash' ? 'Aktion' : 'Versand'}</dt>
                <dd>
                  {selected.mail.kind === 'trash'
                    ? 'In den Gmail-Papierkorb verschieben'
                    : selected.mail.sendAt
                      ? `${new Date(selected.mail.sendAt).toLocaleString('de-DE', { timeZone: selected.mail.timezone, timeZoneName: 'short' })} (${selected.mail.timezone})`
                      : selected.status === 'draft'
                        ? 'Sofort nach Freigabe'
                        : 'Sofort'}
                </dd>
              </dl>
              {selected.mail.kind === 'trash' ? (
                <>
                  <p>Ursprünglicher Absender: {selected.mail.sourceFrom}</p>
                  <pre className="mail-body">{selected.mail.originalText}</pre>
                </>
              ) : (
                <pre className="mail-body">{selected.mail.body}</pre>
              )}
              {selected.mail.originalAttached && (
                <p className="notice">
                  Anhang: Original.eml · vollständige Originalmail einschließlich Anhängen
                </p>
              )}
              {selected.mail.kind !== 'trash' && selected.mail.sourceId && (
                <details>
                  <summary>Ursprüngliche Mail anzeigen</summary>
                  <p>
                    {selected.mail.sourceSubject} · {selected.mail.sourceFrom}
                  </p>
                  <pre className="mail-body">{selected.mail.originalText}</pre>
                </details>
              )}
              {selected.error && <ErrorMessage error={selected.error} />}
              {selected.status === 'draft' && (
                <p className="small">Du gibst genau die hier angezeigte Aktion frei.</p>
              )}
              {selected.status === 'queued' && (
                <p className="small">
                  Der Versand erfolgt durch Open AIPA. Der Server muss laufen; nach einer
                  Unterbrechung wird der Versand nachgeholt.
                </p>
              )}
              <div className="form-actions">
                {selected.status === 'draft' && (
                  <button
                    className="primary"
                    disabled={busy || !access?.canWrite}
                    onClick={() =>
                      void action(async () => {
                        const next = await api<Action>(`/mail/${selected.id}/approve`, post({}));
                        show(next);
                        await refresh();
                      })
                    }
                  >
                    {selected.mail.kind === 'trash' ? (
                      <Trash2 size={16} />
                    ) : selected.mail.sendAt ? (
                      <Clock size={16} />
                    ) : (
                      <Send size={16} />
                    )}
                    {selected.mail.kind === 'trash'
                      ? 'In Papierkorb verschieben'
                      : selected.mail.sendAt
                        ? 'Versand freigeben'
                        : 'Jetzt senden'}
                  </button>
                )}
                {['draft', 'queued'].includes(selected.status) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api(`/mail/${selected.id}/cancel`, post({}));
                        const mail = selected.mail;
                        compose(
                          mail.kind,
                          mail.sourceId
                            ? {
                                id: mail.sourceId,
                                subject: mail.sourceSubject || mail.subject,
                                from: mail.sourceFrom || '',
                                date: '',
                                text: mail.originalText || '',
                              }
                            : undefined,
                          mail,
                        );
                        await refresh();
                      })
                    }
                  >
                    {selected.status === 'queued' ? 'Abbrechen und bearbeiten' : 'Bearbeiten'}
                  </button>
                )}
                {['draft', 'queued'].includes(selected.status) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        show(await api<Action>(`/mail/${selected.id}/cancel`, post({})));
                        await refresh();
                      })
                    }
                  >
                    <X size={16} />
                    Abbrechen
                  </button>
                )}
              </div>
            </>
          ) : source ? (
            <>
              <h3>{source.subject || '(Kein Betreff)'}</h3>
              <p>
                {source.from} · {source.date}
              </p>
              <pre className="mail-body">{source.text}</pre>
              <div className="form-actions">
                <button disabled={!access?.canWrite} onClick={() => compose('reply', source)}>
                  <ArrowLeft size={16} />
                  Antworten
                </button>
                <button disabled={!access?.canWrite} onClick={() => compose('forward', source)}>
                  Weiterleiten
                </button>
                <button disabled={!access?.canWrite} onClick={() => compose('trash', source)}>
                  <Trash2 size={16} />
                  Löschen
                </button>
              </div>
            </>
          ) : (
            <div className="mail-empty">
              <ServiceIcon service="gmail" />
              <h3>Dein Mail-Arbeitsplatz</h3>
              <p>
                Erstelle eine neue E-Mail, öffne einen Entwurf oder suche im Postfach nach einer
                Nachricht.
              </p>
              <p className="small">
                Du kannst deinen Assistenten auch im Chat darum bitten. Entwürfe erscheinen hier zur
                Freigabe.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
