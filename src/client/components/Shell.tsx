import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from '../router';
import { realtime } from '../realtime';
import { useAuth } from '../state';
import { Icon } from './Icon';
import { Logo } from './Logo';

const NAV = [
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/mind', label: 'Mind', icon: 'mind' },
  { to: '/library', label: 'Library', icon: 'library' },
  { to: '/trees', label: 'Trees', icon: 'trees' },
  { to: '/import', label: 'Import', icon: 'import' },
];

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function Shell({ children }: { children: ReactNode }) {
  const { me, signOut } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!me) return;
    const rt = realtime();
    rt.connect();
    const off = rt.on('account_deleted', () => window.location.assign('/'));
    return () => {
      off();
    };
  }, [me]);

  const hoursLeft = me?.user.isDemo === 1 && me.user.expiresAt ? Math.max(0, Math.round((Date.parse(me.user.expiresAt) - Date.now()) / 3600000)) : null;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {hoursLeft !== null && (
        <div className="banner" role="note">
          Demo account — it and everything you import are deleted automatically in about {hoursLeft} h.
          <Link to="/signup">Create a free account</Link> to keep your map.
        </div>
      )}
      {!online && (
        <div className="banner" role="alert" style={{ background: 'var(--danger)' }}>
          You are offline. SOMM will reconnect and sync automatically.
        </div>
      )}
      <header className="topbar">
        <Link to={me ? '/map' : '/'} aria-label="SOMM — Sound of My Mind, home" className="brand" style={{ color: 'var(--white)', textDecoration: 'none' }}>
          <Logo size={26} />
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to}>
              {n.label}
            </NavLink>
          ))}
          <NavLink to="/convert">Convert</NavLink>
        </nav>
        <span className="spacer" />
        {me && (
          <div style={{ position: 'relative' }}>
            <button type="button" className="btn btn-ghost btn-sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              @{me.user.handle}
            </button>
            {menu && (
              <div
                role="menu"
                className="panel panel-tight"
                style={{ position: 'absolute', right: 0, top: 46, minWidth: 220, display: 'grid', gap: 4, zIndex: 50 }}
                onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}
              >
                {[
                  ['/convert', 'Playlist → CSV converter'],
                  ['/u/' + me.user.handle, 'My public profile'],
                  ['/settings/privacy', 'Privacy & sharing'],
                  ['/settings', 'Settings & providers'],
                  ['/settings/account', 'Account & data'],
                ].map(([to, label]) => (
                  <Link key={to} role="menuitem" to={to!} onClick={() => setMenu(false)} className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }}>
                    {label}
                  </Link>
                ))}
                <button
                  role="menuitem"
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={async () => {
                    setMenu(false);
                    realtime().disconnect();
                    await signOut();
                    navigate('/');
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      {me && (
        <nav className="tabbar" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
