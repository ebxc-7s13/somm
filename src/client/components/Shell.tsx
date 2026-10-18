import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { loadClientConfig } from '../clientConfig';
import { useNotifications } from '../notifications';
import { Link, NavLink, useLocation, useNavigate } from '../router';
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

const MENU = [
  ['/u/:handle', 'My public profile', 'users'],
  ['/convert', 'Playlist to CSV converter', 'list'],
  ['/settings', 'Notifications & settings', 'bell'],
  ['/settings/privacy', 'Privacy & sharing', 'shield'],
  ['/settings/account', 'Account & data', 'settings'],
] as const;

/**
 * The account menu. It renders into <body> (the top bar's blur would otherwise clip a
 * full-screen scrim), drops down under the top bar on wide screens and spans the width
 * of the screen on phones. Escape, a tap outside or any navigation closes it.
 */
function AccountMenu({ open, setOpen }: { open: boolean; setOpen: (v: boolean | ((v: boolean) => boolean)) => void }) {
  const { me, signOut } = useAuth();
  const navigate = useNavigate();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!me) return null;
  const move = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <div className="menu-wrap">
      <button ref={button} type="button" className="btn btn-ghost btn-sm user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((m) => !m)}>
        <Icon name="users" size={16} />
        <span className="truncate">@{me.user.handle}</span>
      </button>
      {open &&
        createPortal(
          <>
            <button type="button" className="menu-scrim" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} />
            <div ref={pop} role="menu" aria-label="Account" className="menu-pop" onKeyDown={move}>
              <p className="menu-head">
                <strong className="truncate">{me.user.displayName}</strong>
                <span className="xsmall faint truncate">@{me.user.handle}</span>
              </p>
              {MENU.map(([to, label, icon]) => (
                <Link key={to} role="menuitem" to={to.replace(':handle', me.user.handle)} onClick={() => setOpen(false)} className="menu-item">
                  <Icon name={icon} size={18} /> {label}
                </Link>
              ))}
              <hr className="menu-sep" />
              <button
                role="menuitem"
                type="button"
                className="menu-item"
                onClick={async () => {
                  setOpen(false);
                  realtime().disconnect();
                  await signOut();
                  navigate('/');
                }}
              >
                <Icon name="close" size={18} /> Sign out
              </button>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const online = useOnline();
  const [menu, setMenu] = useState(false);
  const { totalUnread } = useNotifications();
  const { pathname } = useLocation();
  // Any navigation closes the account menu.
  useEffect(() => setMenu(false), [pathname]);
  const badge = (to: string) =>
    to === '/trees' && totalUnread > 0 ? (
      <span className="count-badge" aria-label={`${totalUnread} new message${totalUnread === 1 ? '' : 's'}`}>
        {totalUnread > 99 ? '99+' : totalUnread}
      </span>
    ) : null;

  useEffect(() => {
    if (!me) return;
    let alive = true;
    const rt = realtime();
    // Serverless hosts have no WebSocket server; pages poll instead.
    void loadClientConfig().then((cfg) => alive && cfg.realtime === 'ws' && rt.connect());
    const off = rt.on('account_deleted', () => window.location.assign('/'));
    return () => {
      alive = false;
      off();
    };
  }, [me]);


  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
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
              {badge(n.to)}
            </NavLink>
          ))}
          <NavLink to="/convert">Convert</NavLink>
        </nav>
        <span className="spacer" />
        {me && <AccountMenu open={menu} setOpen={setMenu} />}
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      {me && (
        <nav className="tabbar" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to}>
              <span className="tab-icon">
                <Icon name={n.icon} />
                {badge(n.to)}
              </span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
