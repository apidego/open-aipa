import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, LoaderCircle, MessageSquare, Plus } from 'lucide-react';
import { api, date, post, type Conversation } from '../api';
import { Empty, ErrorMessage, Loading, PageTitle } from '../components/ui';
import './ConversationOverview.css';

export function ConversationOverview() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Conversation[]>();
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError('');
    setItems(undefined);
    api<Conversation[]>('/conversations')
      .then((data) => {
        if (alive) setItems(data);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  async function create() {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const data = await api<{ id: string }>('/conversations', post({}));
      navigate(`/conversations/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageTitle
        title="Konversationen"
        description="Gespeicherte Gespräche öffnen oder eine neue Konversation starten."
        action={
          <button className="primary" disabled={creating} onClick={create}>
            {creating ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
            {creating ? 'Wird erstellt …' : 'Neue Konversation'}
          </button>
        }
      />
      <ErrorMessage error={error} />
      <section className="card conversation-overview" aria-labelledby="conversation-overview-title">
        <div className="card-heading">
          <h3 id="conversation-overview-title">
            Deine Konversationen {items && <span className="count">{items.length}</span>}
          </h3>
          <MessageSquare size={18} aria-hidden="true" />
        </div>
        {!items ? (
          error ? (
            <button onClick={() => setAttempt(attempt + 1)}>Erneut versuchen</button>
          ) : (
            <Loading />
          )
        ) : items.length ? (
          <ul className="conversation-overview-list">
            {items.map((item) => (
              <li key={item.id}>
                <Link className="list-row" to={`/conversations/${item.id}`}>
                  <span className="row-icon">
                    <MessageSquare size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>Erstellt am {date(item.created_at)}</small>
                  </div>
                  <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Keine Konversationen vorhanden.">
            Starte eine neue Konversation. Deine Gespräche findest du anschließend hier wieder.
          </Empty>
        )}
      </section>
    </>
  );
}
