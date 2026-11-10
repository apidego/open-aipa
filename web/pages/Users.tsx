import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api, post, type User } from '../api';
import { ErrorMessage, Field, Form, PageTitle } from '../components/ui';
export function Users({ user }: { user: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const refresh = () => api<User[]>('/users').then(setUsers);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="GEMEINSAM ARBEITEN"
        title="Dein Team. Dein Workspace."
        description="Nur Administratoren können neue Nutzer hinzufügen. Gespräche und Gmail-Konten bleiben persönlich."
      />
      <ErrorMessage error={error} />
      <div className="settings-grid">
        <section className="card">
          <h3>
            Nutzer verwalten <span className="count">{users.length}</span>
          </h3>
          {users.map((u) => (
            <div className="list-row" key={u.id}>
              <span className="account-avatar small-avatar">{u.name[0].toUpperCase()}</span>
              <div>
                <strong>
                  {u.name}
                  {u.id === user.id ? ' (Du)' : ''}
                </strong>
                <small>{u.email}</small>
              </div>
              <span className="badge">{u.role === 'admin' ? 'Admin' : 'Nutzer'}</span>
              {u.id !== user.id && (
                <button
                  className="icon-button"
                  aria-label={`${u.name} löschen`}
                  onClick={async () => {
                    if (!confirm(`Nutzer ${u.name} und alle zugehörigen Daten dauerhaft löschen?`))
                      return;
                    try {
                      await api(`/users/${u.id}`, { method: 'DELETE' });
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </section>
        <section className="card">
          <h3>Nutzer hinzufügen</h3>
          <p>
            Teile das Startpasswort über einen sicheren Kanal. Nutzer können es selbst in den
            Einstellungen ändern.
          </p>
          <Form
            key={generation}
            label="Nutzer erstellen"
            submit={async (form) => {
              await api('/users', post(Object.fromEntries(form)));
              await refresh();
              setGeneration((g) => g + 1);
            }}
          >
            <Field label="Name" name="name" />
            <Field label="E-Mail" name="email" type="email" />
            <Field label="Startpasswort" name="password" type="password" minLength={12} />
            <label className="field">
              <span>Rolle</span>
              <select name="role">
                <option value="user">Nutzer</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
          </Form>
        </section>
      </div>
    </>
  );
}
