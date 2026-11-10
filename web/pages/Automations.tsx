import { useEffect, useState } from 'react';
import { Pause, Play, Trash2, Clock3, ChevronRight } from 'lucide-react';
import Markdown from 'react-markdown';
import { api, post, date } from '../api';
import { Empty, ErrorMessage, Field, Form, PageTitle } from '../components/ui';
interface Automation {
  id: string;
  name: string;
  prompt: string;
  interval_minutes: number;
  enabled: number;
  next_run: number;
}
interface Run {
  id: string;
  status: string;
  result: string | null;
  created_at: number;
}
export function Automations() {
  const [items, setItems] = useState<Automation[]>([]);
  const [selected, setSelected] = useState<string>();
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const refresh = () => api<Automation[]>('/automations').then(setItems);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let live = true;
    setRuns([]);
    const update = () => {
      if (selected)
        api<Run[]>(`/automations/${selected}/runs`)
          .then((data) => {
            if (live) setRuns(data);
          })
          .catch((e) => {
            if (live) setError(e.message);
          });
    };
    update();
    const timer = setInterval(update, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selected]);
  async function mutate(id: string, method: string, body?: unknown) {
    try {
      await api(`/automations/${id}`, { method, body: body ? JSON.stringify(body) : undefined });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="LASS DEINEN PA VORAUSDENKEN"
        title="Einmal planen. Wiederkehrend erledigen."
        description="Dein PA führt Aufträge in festen Intervallen aus und hält die Ergebnisse hier für dich bereit."
      />
      <ErrorMessage error={error} />
      <div className="settings-grid">
        <div>
          <section className="card">
            <h3>
              Deine Automatisierungen <span className="count">{items.length}</span>
            </h3>
            {items.length ? (
              items.map((item) => (
                <div className="automation-item" key={item.id}>
                  <button className="automation-title" onClick={() => setSelected(item.id)}>
                    <Clock3 size={18} />
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.enabled ? `Nächster Lauf: ${date(item.next_run)}` : 'Pausiert'} · alle{' '}
                        {item.interval_minutes} Min.
                      </small>
                    </div>
                    <ChevronRight size={15} />
                  </button>
                  <p>{item.prompt}</p>
                  <div className="form-actions">
                    <button onClick={() => mutate(item.id, 'PATCH', { enabled: !item.enabled })}>
                      {item.enabled ? <Pause size={14} /> : <Play size={14} />}{' '}
                      {item.enabled ? 'Pausieren' : 'Aktivieren'}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`${item.name} löschen`}
                      onClick={() => {
                        if (confirm('Automatisierung und Ergebnisse dauerhaft löschen?')) {
                          if (selected === item.id) setSelected(undefined);
                          void mutate(item.id, 'DELETE');
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <Empty title="Weniger Routine für dich.">
                Zum Beispiel: eine tägliche Zusammenfassung deiner wichtigen E-Mails.
              </Empty>
            )}
          </section>
          {selected && (
            <section className="card run-results">
              <h3>Letzte Ergebnisse</h3>
              {runs.length ? (
                runs.map((run) => (
                  <article key={run.id}>
                    <div className="card-heading">
                      <small>{date(run.created_at)}</small>
                      <span className="badge">
                        {{ completed: 'Erledigt', failed: 'Fehler', running: 'Läuft' }[run.status]}
                      </span>
                    </div>
                    <Markdown>{run.result || 'Dein PA arbeitet daran …'}</Markdown>
                  </article>
                ))
              ) : (
                <p>Noch keine Ausführungen. Der erste Lauf startet zum angegebenen Zeitpunkt.</p>
              )}
            </section>
          )}
        </div>
        <section className="card">
          <h3>Neuer Auftrag</h3>
          <p>
            Jeder Lauf verwendet den aktuellen System-Prompt und deine verbundenen Integrationen.
          </p>
          <Form
            key={generation}
            label="Automatisierung erstellen"
            submit={async (form) => {
              await api(
                '/automations',
                post({
                  name: form.get('name'),
                  prompt: form.get('prompt'),
                  intervalMinutes: Number(form.get('intervalMinutes')),
                }),
              );
              await refresh();
              setGeneration((g) => g + 1);
            }}
          >
            <Field label="Name" name="name" placeholder="Mein tägliches Briefing" />
            <label className="field">
              <span>Auftrag an deinen PA</span>
              <textarea
                name="prompt"
                rows={5}
                required
                maxLength={16000}
                placeholder="Fasse meine ungelesenen E-Mails zusammen und nenne die drei wichtigsten nächsten Schritte."
              />
            </label>
            <label className="field">
              <span>Wiederholen</span>
              <select name="intervalMinutes" defaultValue="1440">
                <option value="15">Alle 15 Minuten</option>
                <option value="60">Jede Stunde</option>
                <option value="1440">Alle 24 Stunden</option>
                <option value="10080">Alle 7 Tage</option>
              </select>
            </label>
            <p className="notice">
              Der Server muss laufen. Jeder Auftrag nutzt deine OpenAI-API und kann Kosten
              verursachen. Gmail-Zugriff ist aktuell ausschließlich lesend.
            </p>
          </Form>
        </section>
      </div>
    </>
  );
}
