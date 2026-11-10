import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowUp, ArrowLeft, Plus, Trash2, LoaderCircle } from 'lucide-react';
import Markdown from 'react-markdown';
import { api, post, type Conversation } from '../api';
import { Brand, Empty, ErrorMessage, Loading, PageTitle } from '../components/ui';
import './Conversations.css';
interface Message {
  role: 'user' | 'assistant';
  content: string;
}
export function Conversations() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const history = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const refresh = () => api<Conversation[]>('/conversations').then(setItems);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    return () => active.current?.abort();
  }, []);
  useEffect(() => {
    let alive = true;
    active.current?.abort();
    setBusy(false);
    setError('');
    setLoadError('');
    setContextNotice(null);
    setMessages([]);
    setDraft((location.state as { prompt?: string })?.prompt || '');
    if (id) {
      setLoading(true);
      api<Message[]>(`/conversations/${id}`)
        .then((data) => {
          if (alive) setMessages(data);
        })
        .catch((e) => {
          if (alive) setLoadError(e.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    } else setLoading(false);
    return () => {
      alive = false;
    };
  }, [id, attempt]);
  useEffect(() => {
    const container = history.current;
    container?.scrollTo({
      top: container.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [messages]);
  async function create() {
    if (creating || busy) return;
    setCreating(true);
    try {
      const data = await api('/conversations', post({}));
      await refresh();
      navigate(`/conversations/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function send() {
    if (!draft.trim() || busy || loading || loadError || !id) return;
    const text = draft.trim();
    const previous = messages;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setDraft('');
    setMessages([...previous, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    try {
      const response = await fetch(`/api/conversations/${id}/messages`, {
        ...post({ content: text }),
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';
      let done = false;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = block.match(/^event: (.+)$/m)?.[1];
          const raw = block.match(/^data: (.+)$/m)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw);
          if (event === 'error') throw new Error(data.error);
          if (event === 'context') setContextNotice(data.notice || null);
          if (event === 'done') done = true;
          if (event === 'delta') {
            answer += data.text;
            setMessages([
              ...previous,
              { role: 'user', content: text },
              { role: 'assistant', content: answer },
            ]);
          }
        }
      }
      if (!done)
        throw new Error(
          'Verbindung unterbrochen. Bitte lade die Konversation neu, bevor du erneut sendest.',
        );
      const saved = await api<Message[]>(`/conversations/${id}`);
      if (!controller.signal.aborted) setMessages(saved);
      await refresh();
    } catch (e) {
      if (!controller.signal.aborted) {
        setMessages(previous);
        setDraft(text);
        setError((e as Error).message);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="chat-page">
      <Link className="chat-back" to="/conversations">
        <ArrowLeft size={15} />
        Alle Konversationen
      </Link>
      <PageTitle
        title={items.find((item) => item.id === id)?.title || 'Konversation'}
        description="Nachrichten und Antworten in dieser Konversation."
        action={
          <button className="primary" onClick={create} disabled={creating || busy}>
            {creating ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
            {creating ? 'Wird erstellt …' : 'Neue Konversation'}
          </button>
        }
      />
      <section className="card chat" aria-label="Chat">
        <div className="chat-heading">
          <div className="wordmark">
            <Brand />
            <div>
              <strong>Open AIPA</strong>
              <small>{busy ? 'Dein PA antwortet …' : 'Dein persönlicher Assistent'}</small>
            </div>
          </div>
          {id && (
            <button
              className="icon-button"
              disabled={busy}
              aria-label="Konversation löschen"
              onClick={async () => {
                if (!confirm('Diese Konversation dauerhaft löschen?')) return;
                try {
                  await api(`/conversations/${id}`, { method: 'DELETE' });
                  await refresh();
                  navigate('/conversations');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Trash2 size={17} />
            </button>
          )}
        </div>
        <div
          className="messages"
          ref={history}
          role="log"
          aria-label="Nachrichtenverlauf"
          aria-busy={loading}
        >
          {loading ? (
            <Loading />
          ) : loadError ? (
            <div className="chat-load-error">
              <ErrorMessage error={loadError} />
              <button onClick={() => setAttempt(attempt + 1)}>Erneut versuchen</button>
            </div>
          ) : (
            !messages.length && (
              <Empty title="Noch keine Nachrichten.">
                Schreibe eine Nachricht, um die Konversation zu beginnen.
              </Empty>
            )
          )}
          {messages.map((m, i) => (
            <article className={`message ${m.role}`} key={i}>
              <span className="message-label">{m.role === 'user' ? 'Du' : 'Open AIPA'}</span>
              {m.content ? (
                <Markdown>{m.content}</Markdown>
              ) : (
                <span role="status" aria-label="Antwort wird erstellt">
                  <LoaderCircle size={19} className="spin" />
                </span>
              )}
            </article>
          ))}
        </div>
        <div className="composer-wrap">
          {contextNotice && (
            <p className="notice" role="status">
              {contextNotice}
            </p>
          )}
          <ErrorMessage error={error} />
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              aria-label="Nachricht"
              placeholder="Schreib deinem PA …"
              value={draft}
              maxLength={16000}
              disabled={!id || busy || loading || !!loadError}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="primary icon-button"
              aria-label="Nachricht senden"
              disabled={!id || !draft.trim() || busy || loading || !!loadError}
            >
              {busy ? <LoaderCircle size={19} className="spin" /> : <ArrowUp size={20} />}
            </button>
          </form>
          <small>
            Dein PA kann sich irren. Prüfe wichtige Informationen. · Shift + Enter für eine neue
            Zeile
          </small>
        </div>
      </section>
    </div>
  );
}
