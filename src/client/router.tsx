/**
 * A ~60-line History API router — enough for SOMM's routes without a dependency.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

interface Location {
  pathname: string;
  search: string;
}

const RouterContext = createContext<{ location: Location; navigate: (to: string, opts?: { replace?: boolean }) => void }>({
  location: { pathname: '/', search: '' },
  navigate: () => {},
});

function current(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(current);
  useEffect(() => {
    const onPop = () => setLocation(current());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setLocation(current());
    if (!to.includes('#')) window.scrollTo({ top: 0 });
  }, []);
  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useLocation() {
  return useContext(RouterContext).location;
}

export function useNavigate() {
  return useContext(RouterContext).navigate;
}

export function useQuery(): URLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Match "/trees/:slug/chat" against a pathname. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const navigate = useNavigate();
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
        if (/^https?:/.test(to)) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function NavLink({ to, children, exact = false, ...rest }: { to: string; children: ReactNode; exact?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { pathname } = useLocation();
  const active = exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Link to={to} aria-current={active ? 'page' : undefined} {...rest}>
      {children}
    </Link>
  );
}
