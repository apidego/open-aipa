import { useEffect, useState } from 'react';
import {
  MessageSquare,
  Plug,
  Workflow,
  ListTodo,
  ArrowUpRight,
  ArrowRight,
  Clock3,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, post, date, type Conversation } from '../api';
import { Empty, ErrorMessage, Loading, PageTitle } from '../components/ui';
import { ServiceIcon } from '../components/ServiceIcon';
import { Notifications } from '../components/Notifications';
interface DashboardData {
  conversations: number;
  integrations: number;
  automations: number;
  tasks: number;
  model: string;
  recent: Conversation[];
  runs: {
    id: string;
    status: string;
    created_at: number;
    name: string;
    job_id: string;
    kind: string;
  }[];
}
export function Dashboard() {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    api<DashboardData>('/dashboard')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const start = async (prompt?: string) => {
    try {
      const { id } = await api('/conversations', post({}));
      navigate(`/conversations/${id}`, { state: { prompt } });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!data) return error ? <ErrorMessage error={error} /> : <Loading />;
  return (
    <>
      <PageTitle
        title="Dashboard"
        description="Konversationen, Integrationen und geplante Ausführungen im Überblick."
        action={
          <button className="primary" onClick={() => start()}>
            Konversation starten
            <ArrowUpRight size={17} />
          </button>
        }
      />
      <ErrorMessage error={error} />
      <div className="stats">
        {[
          {
            label: 'Konversationen',
            value: data.conversations,
            icon: MessageSquare,
            text: 'Gespeicherte Gespräche',
            to: '/conversations',
          },
          {
            label: 'Verbundene Integrationen',
            value: data.integrations,
            icon: Plug,
            text: 'Verbundene Dienste',
            to: '/integrations',
          },
          {
            label: 'Automatisierungen',
            value: data.automations,
            icon: Workflow,
            text: 'Zeitgesteuerte Skripte',
            to: '/automations',
          },
          {
            label: 'Aufgaben',
            value: data.tasks,
            icon: ListTodo,
            text: 'Geplante KI-Aufträge',
            to: '/tasks',
          },
        ].map((item) => (
          <Link to={item.to} className="stat card" key={item.label}>
            <div>
              <span>{item.label}</span>
              <item.icon size={18} />
            </div>
            <strong>{String(item.value).padStart(2, '0')}</strong>
            <small>{item.text}</small>
          </Link>
        ))}
      </div>
      <Notifications />
      <div className="dashboard-grid">
        <section className="card assistant-card">
          <h2>Neue Konversation</h2>
          <p>Stelle eine Frage oder beschreibe einen Auftrag.</p>
          <div className="prompt-entry">
            <input
              aria-label="Auftrag an deinen PA"
              placeholder="Ich möchte heute …"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim())
                  void start(e.currentTarget.value);
              }}
            />
            <ArrowRight size={20} />
          </div>
          <div className="suggestions">
            {[
              'Plane meinen Tag',
              'Fasse meine ungelesenen E-Mails zusammen',
              'Hilf mir, eine Idee zu strukturieren',
            ].map((prompt) => (
              <button key={prompt} onClick={() => start(prompt)}>
                {prompt}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
          <div className="assistant-meta">
            <span>Modell</span>
            <strong>{data.model}</strong>
            <span>Auf deinem Server</span>
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <h3>Letzte Konversationen</h3>
            <Link to="/conversations" aria-label="Alle Konversationen">
              <ArrowUpRight size={19} />
            </Link>
          </div>
          {data.recent.length ? (
            <div className="rows">
              {data.recent.map((c) => (
                <Link to={`/conversations/${c.id}`} className="list-row" key={c.id}>
                  <span className="row-icon">
                    <MessageSquare size={17} />
                  </span>
                  <div>
                    <strong>{c.title}</strong>
                    <small>{date(c.created_at)}</small>
                  </div>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="Keine Konversationen vorhanden.">Neue Gespräche erscheinen hier.</Empty>
          )}
        </section>
        <section className="card">
          <div className="card-heading">
            <h3>Letzte Ausführungen</h3>
            <Clock3 size={17} />
          </div>
          {data.runs.length ? (
            data.runs.map((run) => (
              <Link
                className="list-row"
                to={run.kind === 'task' ? '/tasks' : '/automations'}
                key={run.id}
              >
                <span className={`run-dot ${run.status}`} />
                <div>
                  <strong>{run.name}</strong>
                  <small>{date(run.created_at)}</small>
                </div>
                <span className="badge">
                  {{ completed: 'Erledigt', failed: 'Fehler', running: 'Läuft' }[run.status]}
                </span>
              </Link>
            ))
          ) : (
            <Empty title="Noch keine Ausführungen.">
              Ergebnisse von Aufgaben und Automatisierungen erscheinen hier.
            </Empty>
          )}
        </section>
        <section className="card integration-teaser">
          <div className="integration-logo">
            <ServiceIcon service="gmail" />
          </div>
          <div>
            <h3>Gmail verbinden</h3>
            <p>Verbinde Gmail, um E-Mails über die Integration zu suchen und zu lesen.</p>
            <Link className="text-link" to="/integrations">
              Integrationen entdecken
              <ArrowRight size={15} />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
