import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Plug,
  Workflow,
  ListTodo,
  Mail as MailIcon,
  Settings as SettingsIcon,
  Users as UsersIcon,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import { api, post, type User } from './api';
import { Brand, ErrorMessage, Loading } from './components/ui';
import { Access } from './pages/Access';
import { Dashboard } from './pages/Dashboard';
import { Conversations } from './pages/Conversations';
import { ConversationOverview } from './pages/ConversationOverview';
import { Mail } from './pages/Mail';
import { Integrations } from './pages/Integrations';
import { ScheduledJobs } from './pages/ScheduledJobs';
import { Settings } from './pages/Settings';
import { Users } from './pages/Users';
import './style.css';
function App() {
  const [session, setSession] = useState<{ user: User | null; setupRequired: boolean }>();
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('pa-sidebar-collapsed');
      return saved === null ? window.matchMedia('(max-width: 600px)').matches : saved === 'true';
    } catch {
      return false;
    }
  });
  const location = useLocation();
  const reload = async () => {
    setSession(await api('/session'));
  };
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('pa-sidebar-collapsed', String(collapsed));
    } catch {
      /* Storage can be unavailable in private contexts. */
    }
  }, [collapsed]);
  if (!session)
    return (
      <main className="startup">
        {error ? (
          <>
            <ErrorMessage error={error} />
            <button onClick={() => window.location.reload()}>Erneut versuchen</button>
          </>
        ) : (
          <Loading />
        )}
      </main>
    );
  if (!session.user) return <Access setup={session.setupRequired} reload={reload} />;
  const user = session.user;
  const links = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/conversations', label: 'Konversationen', icon: MessageSquare },
    { to: '/integrations', label: 'Integrationen', icon: Plug },
    { to: '/mail', label: 'E-Mails', icon: MailIcon },
    { to: '/automations', label: 'Automatisierungen', icon: Workflow },
    { to: '/tasks', label: 'Aufgaben', icon: ListTodo },
  ];
  const title =
    [...links, { to: '/settings', label: 'Einstellungen' }, { to: '/users', label: 'Nutzer' }].find(
      (link) =>
        link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to),
    )?.label || 'Workspace';
  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <NavLink to="/" className="wordmark" aria-label="Open AIPA Dashboard">
          <Brand />
          <span className="nav-text">Open AIPA</span>
        </NavLink>
        <div className="workspace-label nav-text">WORKSPACE</div>
        <nav
          aria-label="Hauptnavigation"
          onClick={() => {
            if (window.matchMedia('(max-width: 600px)').matches) setCollapsed(true);
          }}
        >
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              title={collapsed ? link.label : undefined}
              aria-label={link.label}
            >
              <link.icon size={20} strokeWidth={1.6} />
              <span className="nav-text">{link.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <nav
            aria-label="Verwaltung"
            onClick={() => {
              if (window.matchMedia('(max-width: 600px)').matches) setCollapsed(true);
            }}
          >
            {user.role === 'admin' && (
              <NavLink to="/users" title="Nutzer" aria-label="Nutzer">
                <UsersIcon size={20} strokeWidth={1.6} />
                <span className="nav-text">Nutzer</span>
              </NavLink>
            )}
            <NavLink to="/settings" title="Einstellungen" aria-label="Einstellungen">
              <SettingsIcon size={20} strokeWidth={1.6} />
              <span className="nav-text">Einstellungen</span>
            </NavLink>
          </nav>
          <button
            className="collapse-toggle"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
            aria-label={collapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            <span className="nav-text">Einklappen</span>
          </button>
          <div className="sidebar-user">
            <span className="avatar">{user.name[0].toUpperCase()}</span>
            <div className="nav-text">
              <strong>{user.name}</strong>
              <small>{user.role === 'admin' ? 'Administrator' : 'Persönlicher Workspace'}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>{title}</span>
          <div>
            <a
              href="https://github.com/apidego/open-aipa"
              target="_blank"
              rel="noreferrer"
              className="repo-link"
            >
              Open Source
              <ExternalLink size={12} />
            </a>
            <span className="top-divider" />
            <button
              className="icon-button"
              aria-label="Abmelden"
              title="Abmelden"
              onClick={async () => {
                try {
                  await api('/logout', post({}));
                  await reload();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main
          className={`content ${location.pathname.startsWith('/conversations/') ? 'chat-content' : ''}`}
        >
          <ErrorMessage error={error} />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/conversations" element={<ConversationOverview />} />
            <Route path="/conversations/:id" element={<Conversations />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/integrations" element={<Integrations user={user} />} />
            <Route
              path="/automations"
              element={<ScheduledJobs key="automations" kind="automation" />}
            />
            <Route path="/tasks" element={<ScheduledJobs key="tasks" kind="task" />} />
            <Route path="/settings" element={<Settings user={user} />} />
            <Route
              path="/users"
              element={user.role === 'admin' ? <Users user={user} /> : <Navigate to="/" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
