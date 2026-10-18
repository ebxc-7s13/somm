import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { useClientConfig } from './clientConfig';
import { GlobalFx } from './fx/GlobalFx';
import { CallProvider } from './components/CallOverlay';
import { Shell } from './components/Shell';
import { ErrorState, Loading } from './components/States';
import { matchPath, RouterProvider, useLocation, useNavigate } from './router';
import { AuthProvider, ToastProvider, useAuth } from './state';
import { Landing } from './pages/Landing';
import { SignIn, SignUp } from './pages/Auth';

const lazyPage = <K extends string>(loader: () => Promise<Record<K, ComponentType<any>>>, name: K) =>
  lazy(async () => ({ default: (await loader())[name] }));

const Onboarding = lazyPage(() => import('./pages/Onboarding'), 'Onboarding');
const ImportPage = lazyPage(() => import('./pages/Import'), 'ImportPage');
const ConvertPage = lazyPage(() => import('./pages/Convert'), 'ConvertPage');
const ImportJobPage = lazyPage(() => import('./pages/ImportJob'), 'ImportJobPage');
const LibraryPage = lazyPage(() => import('./pages/Library'), 'LibraryPage');
const TrackDetailPage = lazyPage(() => import('./pages/TrackDetail'), 'TrackDetailPage');
const MapPage = lazyPage(() => import('./pages/MapPage'), 'MapPage');
const MindPage = lazyPage(() => import('./pages/Mind'), 'MindPage');
const TreesPage = lazyPage(() => import('./pages/Trees'), 'TreesPage');
const TreePage = lazyPage(() => import('./pages/TreeDetail'), 'TreePage');
const ComparePage = lazyPage(() => import('./pages/Compare'), 'ComparePage');
const ProfilePage = lazyPage(() => import('./pages/Profile'), 'ProfilePage');
const SettingsPage = lazyPage(() => import('./pages/Settings'), 'SettingsPage');
const PrivacyPage = lazyPage(() => import('./pages/Settings'), 'PrivacyPage');
const AccountPage = lazyPage(() => import('./pages/Settings'), 'AccountPage');

interface Route {
  path: string;
  component: ComponentType<{ params: Record<string, string> }>;
  auth: boolean;
  bare?: boolean;
}

const ROUTES: Route[] = [
  { path: '/', component: Landing, auth: false, bare: true },
  { path: '/signin', component: SignIn, auth: false },
  { path: '/signup', component: SignUp, auth: false },
  { path: '/welcome', component: Onboarding, auth: true },
  { path: '/import', component: ImportPage, auth: true },
  { path: '/convert', component: ConvertPage, auth: false },
  { path: '/import/jobs/:id', component: ImportJobPage, auth: true },
  { path: '/library', component: LibraryPage, auth: true },
  { path: '/library/tracks/:id', component: TrackDetailPage, auth: true },
  { path: '/map', component: MapPage, auth: true },
  { path: '/mind', component: MindPage, auth: true },
  { path: '/trees', component: TreesPage, auth: true },
  { path: '/trees/:slug', component: TreePage, auth: true },
  { path: '/trees/:slug/:tab', component: TreePage, auth: true },
  { path: '/compare/:handle', component: ComparePage, auth: true },
  { path: '/u/:handle', component: ProfilePage, auth: false },
  { path: '/settings', component: SettingsPage, auth: true },
  { path: '/settings/privacy', component: PrivacyPage, auth: true },
  { path: '/settings/account', component: AccountPage, auth: true },
];

function NotFound() {
  return (
    <div className="page">
      <ErrorState error={new Error('There is nothing at this address. It may have moved, or the Tree may no longer exist.')} title="Page not found" />
    </div>
  );
}

function Routes() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { me, loading } = useAuth();
  let match: { route: Route; params: Record<string, string> } | null = null;
  for (const route of ROUTES) {
    const params = matchPath(route.path, pathname);
    if (params) {
      match = { route, params };
      break;
    }
  }
  const needsAuth = !!match?.route.auth && !me && !loading;
  useEffect(() => {
    if (needsAuth) navigate(`/signin?next=${encodeURIComponent(pathname + search)}`, { replace: true });
  }, [needsAuth, navigate, pathname, search]);

  if (!match) return <Shell><NotFound /></Shell>;
  const Page = match.route.component;
  if (match.route.bare) return <Page params={match.params} />;
  if (match.route.auth && (loading || !me)) {
    return (
      <Shell>
        <div className="page">
          <Loading label="Checking your session…" />
        </div>
      </Shell>
    );
  }
  return (
    <Shell>
      <Suspense
        fallback={
          <div className="page">
            <Loading />
          </div>
        }
      >
        <Page key={pathname} params={match.params} />
      </Suspense>
    </Shell>
  );
}

function WithCalls() {
  const { me } = useAuth();
  // Calls need the WebSocket connection, which serverless hosts do not offer.
  const cfg = useClientConfig();
  return (
    <CallProvider enabled={!!me && cfg?.realtime === 'ws' && cfg.calls}>
      <Routes />
    </CallProvider>
  );
}

export function App() {
  return (
    <RouterProvider>
      <GlobalFx />
      <ToastProvider>
        <AuthProvider>
          <WithCalls />
        </AuthProvider>
      </ToastProvider>
    </RouterProvider>
  );
}
