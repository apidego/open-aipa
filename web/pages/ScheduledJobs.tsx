import { useEffect, useState, type FormEvent } from 'react';
import { Clock3, Code2, Pause, Play, Trash2, Sparkles, LoaderCircle } from 'lucide-react';
import Markdown from 'react-markdown';
import { api, post, date } from '../api';
import { Empty, ErrorMessage, Loading, PageTitle } from '../components/ui';
import './ScheduledJobs.css';
interface Schedule {
  kind: 'once' | 'interval' | 'cron';
  at: string | null;
  minutes: number | null;
  cron: string | null;
  timezone: string;
}
interface Job {
  id: string;
  name: string;
  description: string;
  prompt: string;
  input_prompt: string;
  script: string | null;
  schedule: Schedule;
  channel: string;
  allow_ai: number;
  status: 'draft' | 'active' | 'paused' | 'completed';
  next_run: number | null;
  upcoming: number[];
}
interface Run {
  id: string;
  status: string;
  result: string | null;
  notified: number;
  created_at: number;
}
const statusLabels = {
  draft: 'Entwurf',
  active: 'Aktiv',
  paused: 'Pausiert',
  completed: 'Abgeschlossen',
};
function scheduleLabel(s: Schedule) {
  return s.kind === 'once'
    ? 'Einmalig'
    : s.kind === 'interval'
      ? `Alle ${s.minutes} Minuten`
      : 'Wiederkehrende Uhrzeiten';
}
function localTime(at: number, zone: string) {
  return new Intl.DateTimeFormat('de', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(at);
}
export function ScheduledJobs({ kind }: { kind: 'automation' | 'task' }) {
  const scriptMode = kind === 'automation';
  const title = scriptMode ? 'Automatisierungen' : 'Aufgaben';
  const path = scriptMode ? '/automations' : '/tasks';
  const [items, setItems] = useState<Job[]>();
  const [selected, setSelected] = useState<string>();
  const [runs, setRuns] = useState<Run[]>();
  const [prompt, setPrompt] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
  );
  const [allowAI, setAllowAI] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [generation, setGeneration] = useState(0);
  const job = items?.find((item) => item.id === selected);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api<Job[]>(path)
        .then((data) => {
          if (alive) setItems(data);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, generation]);
  useEffect(() => {
    let alive = true;
    setRuns(undefined);
    if (!selected) return;
    const refresh = () =>
      api<Run[]>(`${path}/${selected}/runs`)
        .then((data) => {
          if (alive) setRuns(data);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, selected, generation]);
  async function prepare(event: FormEvent) {
    event.preventDefault();
    setError('');
    setQuestion('');
    setBusy(true);
    try {
      const result = await api<{ job?: Job; clarification?: string }>(
        `${path}/prepare`,
        post({ prompt, timezone, allowAI }),
      );
      if (result.clarification) setQuestion(result.clarification);
      if (result.job) {
        setItems((current) => [result.job!, ...(current || [])]);
        setSelected(result.job.id);
        setGeneration((g) => g + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(job: Job, action: 'active' | 'paused' | 'delete') {
    if (action === 'delete' && !confirm('Diesen Eintrag und seinen Ausführungsverlauf löschen?'))
      return;
    setError('');
    setMutating(true);
    try {
      await api(
        `${path}/${job.id}`,
        action === 'delete'
          ? { method: 'DELETE' }
          : { method: 'PATCH', body: JSON.stringify({ status: action }) },
      );
      if (action === 'delete') setSelected(undefined);
      setItems(await api<Job[]>(path));
      setGeneration((g) => g + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMutating(false);
    }
  }
  return (
    <>
      <PageTitle
        title={title}
        description={
          scriptMode
            ? 'Beschreibe einen Ablauf. Die KI erstellt ein Skript, das anschließend nach Zeitplan ausgeführt wird.'
            : 'Beschreibe einen Auftrag und seinen Zeitpunkt. Die KI bearbeitet ihn bei jeder Ausführung.'
        }
      />
      <ErrorMessage error={error} />
      <div className="scheduled-grid">
        <div>
          <section className="card">
            <div className="card-heading">
              <h3>
                {title} {items && <span className="count">{items.length}</span>}
              </h3>
              <Clock3 size={18} />
            </div>
            {!items ? (
              error ? (
                <button onClick={() => setGeneration((g) => g + 1)}>Erneut versuchen</button>
              ) : (
                <Loading />
              )
            ) : items.length ? (
              items.map((item) => (
                <button
                  className={`scheduled-item ${item.id === selected ? 'selected' : ''}`}
                  key={item.id}
                  onClick={() => {
                    setSelected(item.id);
                    setError('');
                  }}
                  aria-pressed={item.id === selected}
                >
                  {scriptMode ? <Code2 size={18} /> : <Sparkles size={18} />}
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {scheduleLabel(item.schedule)} · {statusLabels[item.status]}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <Empty title={`Keine ${title} vorhanden.`}>
                Erstelle einen Entwurf mit einem Auftrag und einem Zeitplan.
              </Empty>
            )}
          </section>
          {job && (
            <section className="card scheduled-detail">
              <div className="card-heading">
                <h3>{job.name}</h3>
                <span className="badge">{statusLabels[job.status]}</span>
              </div>
              <p>{job.description}</p>
              <dl className="job-facts">
                <div>
                  <dt>Zeitplan</dt>
                  <dd>{scheduleLabel(job.schedule)}</dd>
                </div>
                <div>
                  <dt>Zeitzone</dt>
                  <dd>{job.schedule.timezone}</dd>
                </div>
                <div>
                  <dt>Benachrichtigungen</dt>
                  <dd>Dashboard · nur bei erfüllter Bedingung</dd>
                </div>
                <div>
                  <dt>KI bei Ausführung</dt>
                  <dd>
                    {scriptMode
                      ? job.allow_ai
                        ? 'Explizite Skript-Aufrufe erlaubt'
                        : 'Nicht erlaubt'
                      : 'Wird verwendet'}
                  </dd>
                </div>
              </dl>
              {job.upcoming.length > 0 && (
                <div className="job-upcoming">
                  <strong>{job.status === 'active' ? 'Nächste Termine' : 'Terminvorschau'}</strong>
                  <ul>
                    {job.upcoming.map((at) => (
                      <li key={at}>{localTime(at, job.schedule.timezone)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <details>
                <summary>Auftrag anzeigen</summary>
                <p className="job-prompt">{job.prompt}</p>
              </details>
              {job.schedule.cron && (
                <details>
                  <summary>Zeitplan im Detail</summary>
                  <code>{job.schedule.cron}</code>
                  <p>Minute · Stunde · Tag · Monat · Wochentag</p>
                </details>
              )}
              {job.script && (
                <details>
                  <summary>Skript anzeigen</summary>
                  <pre className="job-source">
                    <code>{job.script}</code>
                  </pre>
                </details>
              )}
              <div className="form-actions">
                {job.status !== 'completed' && (
                  <button
                    className={job.status === 'draft' ? 'primary' : ''}
                    disabled={mutating}
                    onClick={() => mutate(job, job.status === 'active' ? 'paused' : 'active')}
                  >
                    {job.status === 'active' ? <Pause size={15} /> : <Play size={15} />}
                    {job.status === 'active'
                      ? 'Pausieren'
                      : job.status === 'draft'
                        ? 'Entwurf aktivieren'
                        : 'Fortsetzen'}
                  </button>
                )}
                <button disabled={mutating} onClick={() => mutate(job, 'delete')}>
                  <Trash2 size={15} />
                  Löschen
                </button>
              </div>
              <div className="run-results">
                <h3>Ausführungsverlauf</h3>
                {!runs ? (
                  <Loading />
                ) : !runs.length ? (
                  <p>Noch keine Ausführung.</p>
                ) : (
                  runs.map((run) => (
                    <article key={run.id}>
                      <div className="card-heading">
                        <span className="badge">
                          {
                            {
                              completed: 'Abgeschlossen',
                              failed: 'Fehlgeschlagen',
                              running: 'Läuft',
                            }[run.status]
                          }
                        </span>
                        <small>{date(run.created_at)}</small>
                      </div>
                      {run.status === 'completed' && (
                        <small>
                          {run.notified
                            ? 'Benachrichtigung erstellt'
                            : 'Ohne Benachrichtigung beendet'}
                        </small>
                      )}
                      {run.result && <Markdown>{run.result}</Markdown>}
                    </article>
                  ))
                )}
              </div>
            </section>
          )}
        </div>
        <section className="card job-create">
          <h3>{scriptMode ? 'Automatisierung erstellen' : 'Aufgabe erstellen'}</h3>
          <form onSubmit={prepare}>
            <fieldset disabled={busy}>
              <label className="field">
                <span>Was soll wann passieren?</span>
                <textarea
                  required
                  maxLength={16000}
                  rows={7}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    scriptMode
                      ? 'Prüfe jeden Werktag um 9 Uhr, ob neue Mails von example@example.com da sind. Benachrichtige mich nur bei neuen Treffern.'
                      : 'Prüfe morgen um 10 Uhr mein Gmail-Postfach. Falls eine Mail von XY einen Treffpunkt nennt, gib mir Bescheid. Ansonsten sag nichts.'
                  }
                />
              </label>
              <label className="field">
                <span>Zeitzone</span>
                <input
                  required
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  list="job-timezones"
                />
                <datalist id="job-timezones">
                  <option value="Europe/Berlin" />
                  <option value="Europe/Vienna" />
                  <option value="Europe/Zurich" />
                  <option value="UTC" />
                </datalist>
              </label>
              {scriptMode && (
                <label className="job-checkbox">
                  <input
                    type="checkbox"
                    checked={allowAI}
                    onChange={(e) => setAllowAI(e.target.checked)}
                  />
                  KI-Aufrufe im Skript erlauben
                </label>
              )}
              <p className="job-hint">
                {scriptMode
                  ? 'Das Skript nutzt deine verbundenen Integrationen. Ohne diese Freigabe sind KI-Aufrufe bei der Ausführung gesperrt.'
                  : 'Bei jeder Ausführung wird das konfigurierte KI-Modell verwendet.'}{' '}
                Benachrichtigungen erscheinen im Dashboard. Weitere Kanäle sind noch nicht
                verfügbar.
              </p>
              {question && (
                <div className="notice" role="status">
                  {question}
                </div>
              )}
              <button className="primary" type="submit">
                {busy && <LoaderCircle size={16} className="spin" />}
                {busy ? 'Entwurf wird erstellt …' : 'Entwurf erstellen'}
              </button>
            </fieldset>
          </form>
        </section>
      </div>
    </>
  );
}
