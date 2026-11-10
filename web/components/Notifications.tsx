import { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import Markdown from 'react-markdown';
import { api, date } from '../api';
import { Empty, ErrorMessage, Loading } from './ui';
interface Notice {
  id: string;
  title: string;
  message: string;
  created_at: number;
  read_at: number | null;
}
export function Notifications() {
  const [data, setData] = useState<{ items: Notice[]; unread: number }>();
  const [error, setError] = useState('');
  const refresh = () => api<{ items: Notice[]; unread: number }>('/notifications').then(setData);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api<{ items: Notice[]; unread: number }>('/notifications')
        .then((value) => {
          if (alive) setData(value);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void poll();
    const timer = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section
      className="card notifications"
      id="notifications"
      aria-labelledby="notifications-title"
    >
      <div className="card-heading">
        <h3 id="notifications-title">
          Benachrichtigungen {data && <span className="count">{data.unread} ungelesen</span>}
        </h3>
        <Bell size={18} />
      </div>
      <ErrorMessage error={error} />
      {!data ? (
        error ? (
          <button
            onClick={() => {
              setError('');
              void refresh().catch((e) => setError(e.message));
            }}
          >
            Erneut versuchen
          </button>
        ) : (
          <Loading />
        )
      ) : !data.items.length ? (
        <Empty title="Keine Benachrichtigungen">
          Ergebnisse von Aufgaben und Automatisierungen erscheinen hier, wenn ihre
          Benachrichtigungsbedingung erfüllt ist.
        </Empty>
      ) : (
        data.items.map((item) => (
          <article className={`notification ${item.read_at ? '' : 'unread'}`} key={item.id}>
            <div className="card-heading">
              <h4>{item.title}</h4>
              <small>{date(item.created_at)}</small>
            </div>
            <Markdown>{item.message}</Markdown>
            {!item.read_at && (
              <button
                onClick={async () => {
                  try {
                    await api(`/notifications/${item.id}/read`, { method: 'PATCH' });
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Check size={14} />
                Als gelesen markieren
              </button>
            )}
          </article>
        ))
      )}
      {data && data.items.length >= 50 && (
        <small>Die letzten 50 Benachrichtigungen werden angezeigt.</small>
      )}
    </section>
  );
}
