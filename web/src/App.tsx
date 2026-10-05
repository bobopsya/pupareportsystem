import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { VaultProvider } from './lib/vault';
import { ChangePasswordPage, LoginPage } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Checkins = lazy(() => import('./pages/Checkins'));
const Employees = lazy(() => import('./pages/Employees'));
const Clients = lazy(() => import('./pages/Clients'));
const Vault = lazy(() => import('./pages/Vault'));
const ZeroTier = lazy(() => import('./pages/ZeroTier'));
const Devices = lazy(() => import('./pages/Devices'));
const WifiPage = lazy(() => import('./pages/Wifi'));
const RoutesPage = lazy(() => import('./pages/Routes'));
const MapAll = lazy(() => import('./pages/MapAll'));
const SerialConsole = lazy(() => import('./pages/SerialConsole'));
const Audit = lazy(() => import('./pages/Audit'));
const Trash = lazy(() => import('./pages/Trash'));
const Settings = lazy(() => import('./pages/Settings'));

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <LoginPage />;
  if (user.mustChange) return <ChangePasswordPage forced />;

  return (
    <VaultProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="map" element={<MapAll />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="checkins" element={<Checkins />} />
            <Route path="employees" element={<Employees />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<Clients />} />
            <Route path="vault" element={<Vault />} />
            <Route path="zerotier" element={<ZeroTier />} />
            <Route path="devices" element={<Devices />} />
            <Route path="wifi" element={<WifiPage />} />
            <Route path="routes" element={<RoutesPage />} />
            <Route path="routes/:id" element={<RoutesPage />} />
            <Route path="console" element={<SerialConsole />} />
            <Route path="audit" element={<Audit />} />
            <Route path="trash" element={<Trash />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </VaultProvider>
  );
}
