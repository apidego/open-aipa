import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ErrorMessage } from './ui';
export function DeactivateIntegration({
  id,
  name,
  onClose,
  onSaved,
}: {
  id: string;
  name: string;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [keep, setKeep] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const d = ref.current!;
    const opener = document.activeElement;
    d.showModal();
    return () => {
      d.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="integration-dialog"
      aria-label={`${name} deaktivieren`}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClose={() => {
        if (!ref.current?.open) onClose();
      }}
    >
      <h2>{name} deaktivieren?</h2>
      <p>
        Die Integration ist danach für alle Nutzer ausgeschaltet. Soll die Konfiguration für eine
        spätere Aktivierung gespeichert bleiben?
      </p>
      <ErrorMessage error={error} />
      <fieldset disabled={busy}>
        <label className="field">
          <span>
            <input type="radio" name="keep" checked={keep} onChange={() => setKeep(true)} />{' '}
            Konfiguration behalten
          </span>
          <small>
            Zugangsdaten und persönliche Verknüpfungen bleiben gespeichert, werden aber nicht
            genutzt.
          </small>
        </label>
        <label className="field">
          <span>
            <input type="radio" name="keep" checked={!keep} onChange={() => setKeep(false)} />{' '}
            Konfiguration löschen
          </span>
          <small>
            Gespeicherte Zugangsdaten und Verknüpfungen aller Nutzer werden entfernt.
            Umgebungsvariablen werden danach nicht mehr übernommen. Erteilte Freigaben beim Anbieter
            bleiben bestehen.
          </small>
        </label>
        <div className="form-actions">
          <button onClick={() => ref.current?.close()}>Abbrechen</button>
          <button
            className="danger"
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await api(`/integrations/${id}/activation`, {
                  method: 'PUT',
                  body: JSON.stringify({ enabled: false, keepConfiguration: keep }),
                });
                await onSaved();
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Wird deaktiviert …' : 'Deaktivieren'}
          </button>
        </div>
      </fieldset>
    </dialog>
  );
}
