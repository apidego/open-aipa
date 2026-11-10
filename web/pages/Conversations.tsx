import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowUp, Plus, Trash2, MessageSquare, LoaderCircle } from 'lucide-react';
import Markdown from 'react-markdown';
import { api, post, type Conversation } from '../api';
import { Brand, Empty, ErrorMessage } from '../components/ui';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
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
    setMessages([]);
    setDraft((location.state as { prompt?: string })?.prompt || '');
    if (id) {
      setLoading(true);
      api<Message[]>(`/conversations/${id}`)
        .then((data) => {
          if (alive) setMessages(data);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    } else setLoading(false);
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  async function create() {
    try {
      const data = await api('/conversations', post({}));
      await refresh();
      navigate(`/conversations/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send() {
    if (!draft.trim() || busy || !id) return;
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
    <div className="conversation-layout">
      <aside className="conversation-list">
        <div className="card-heading">
          <h3>Konversationen</h3>
          <button className="icon-button" aria-label="Neue Konversation" onClick={create}>
            <Plus size={19} />
          </button>
        </div>
        <button className="new-chat" onClick={create}>
          <Plus size={16} /> Neues Gespräch
        </button>
        <div className="conversation-items">
          {items.map((c) => (
            <button
              className={`conversation-item ${id === c.id ? 'selected' : ''}`}
              key={c.id}
              onClick={() => navigate(`/conversations/${c.id}`)}
            >
              <MessageSquare size={16} />
              <span>{c.title}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="chat">
        <div className="chat-heading">
          <div className="wordmark">
            <Brand />
            <div>
              <strong>Dein persönlicher Assistent</strong>
              <small>Ein guter Ort für den nächsten Schritt.</small>
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
        <div className="messages">
          {!messages.length && (
            <Empty title={id ? 'Womit fangen wir an?' : 'Ein Gespräch kann vieles bewegen.'}>
              {id ? (
                'Stell eine Frage oder gib deinem PA einen konkreten Auftrag.'
              ) : (
                <button className="primary" onClick={create}>
                  Neue Konversation
                  <Plus size={15} />
                </button>
              )}
            </Empty>
          )}
          {messages.map((m, i) => (
            <article className={`message ${m.role}`} key={i}>
              <span className="message-label">{m.role === 'user' ? 'DU' : 'DEIN PA'}</span>
              {m.content ? (
                <Markdown>{m.content}</Markdown>
              ) : (
                <LoaderCircle size={19} className="spin" />
              )}
            </article>
          ))}
          <div ref={end} />
        </div>
        <div className="composer-wrap">
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
              disabled={!id || busy || loading}
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
              disabled={!id || !draft.trim() || busy || loading}
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
