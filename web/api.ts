export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Die Anfrage ist fehlgeschlagen.');
  return data;
}
export const post = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}
export interface Conversation {
  id: string;
  title: string;
  created_at: number;
}
export const date = (value: number) =>
  new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
