import { useState, type FormEvent, type ReactNode } from 'react';
import { LoaderCircle, ArrowUpRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
export function Brand() {
  return (
    <span className="brand-mark" aria-label="OpenAI PA">
      <span />
      <span />
    </span>
  );
}
export function PageTitle({
  eyebrow = 'DEIN PERSÖNLICHER ASSISTENT',
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <div className="notice error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Sparkles size={28} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> Wird geladen …
    </div>
  );
}
export function Form({
  children,
  submit,
  label = 'Speichern',
  onSuccess,
}: {
  children: ReactNode;
  submit: (data: FormData) => Promise<unknown>;
  label?: string;
  onSuccess?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await submit(new FormData(form));
      setSaved(true);
      onSuccess?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle}>
      <fieldset disabled={busy}>
        {children}
        <ErrorMessage error={error} />
        <div className="form-actions">
          <button className="primary" type="submit">
            {busy && <LoaderCircle size={16} className="spin" />}
            {busy ? 'Bitte warten …' : label}
          </button>
          {saved && (
            <span role="status" className="success">
              Gespeichert
            </span>
          )}
        </div>
      </fieldset>
    </form>
  );
}
export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required = true,
  placeholder,
  minLength,
  help,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
  help?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        minLength={minLength}
        maxLength={type === 'password' ? 500 : 254}
        autoComplete={type === 'password' ? 'new-password' : undefined}
      />
      {help && <small>{help}</small>}
    </label>
  );
}
export function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="card-link" to={to}>
      {children}
      <ArrowUpRight size={16} />
    </Link>
  );
}
