import { useEffect, useState } from 'react';
import { api } from '../api';
import { BotAvatar, type BotProfile } from './BotIdentity';
import { ErrorMessage, Loading } from './ui';
interface Sync {
  state: string;
  message: string;
}
export function BotProfileSettings() {
  const [profile, setProfile] = useState<BotProfile>(),
    [name, setName] = useState(''),
    [avatar, setAvatar] = useState<string | null | undefined>(),
    [sync, setSync] = useState<Sync>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    api<BotProfile>('/bot-profile')
      .then((value) => {
        if (alive) {
          setProfile(value);
          setName(value.name);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    const poll = () =>
      api<Sync>('/bot-profile/sync')
        .then((value) => {
          if (alive) setSync(value);
        })
        .catch(() => {});
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="card">
      <h3>Bot-Profil</h3>
      <p>
        Name und Profilbild für deinen Assistenten. Änderungen gelten für alle Nutzer und werden
        auch auf den verbundenen Discord-Bot übertragen.
      </p>
      <ErrorMessage error={error} />
      {!profile ? (
        <Loading />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setSaved(false);
            try {
              const result = await api<BotProfile & { sync: Sync }>('/bot-profile', {
                method: 'PUT',
                body: JSON.stringify({ name, ...(avatar !== undefined ? { avatar } : {}) }),
              });
              setProfile(result);
              setName(result.name);
              setAvatar(undefined);
              setSync(result.sync);
              setSaved(true);
              window.dispatchEvent(new Event('bot-profile-changed'));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <div className="bot-profile-preview">
              <BotAvatar
                profile={{ name, avatar: avatar === undefined ? profile.avatar : avatar }}
              />
              <strong>{name || 'Dein Assistent'}</strong>
            </div>
            <label className="field">
              <span>Bot-Name</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                minLength={2}
                maxLength={32}
                required
              />
            </label>
            <label className="field">
              <span>Profilbild</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setError('');
                  setSaved(false);
                  if (file.size > 2 * 1024 * 1024) {
                    setError('Das Profilbild darf höchstens 2 MB groß sein.');
                    e.target.value = '';
                    return;
                  }
                  try {
                    const data = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(String(reader.result));
                      reader.onerror = reject;
                      reader.readAsDataURL(file);
                    });
                    setAvatar(data);
                  } catch {
                    setError('Bild konnte nicht geladen werden.');
                  }
                }}
              />
              <small>
                PNG, JPEG oder WebP · maximal 2 MB. Wird auf 256 × 256 Pixel zugeschnitten.
              </small>
            </label>
            {(avatar === undefined ? profile.avatar : avatar) && (
              <button
                type="button"
                onClick={() => {
                  setAvatar(null);
                  setSaved(false);
                }}
              >
                Profilbild entfernen
              </button>
            )}
            <div className="form-actions">
              <button className="primary" type="submit">
                {busy ? 'Wird gespeichert …' : 'Bot-Profil speichern'}
              </button>
              {saved && (
                <span role="status" className="success">
                  Gespeichert
                </span>
              )}
            </div>
            {sync && <p role="status">{sync.message}</p>}
            {sync?.state === 'error' && (
              <button
                type="button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    setSync(await api<Sync>('/bot-profile/sync', { method: 'POST', body: '{}' }));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Discord-Synchronisierung erneut versuchen
              </button>
            )}
          </fieldset>
        </form>
      )}
    </section>
  );
}
