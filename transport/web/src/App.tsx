import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loading } from './components/ui';
import Home from './pages/Home';

const History = lazy(() => import('./pages/History'));
const RidePage = lazy(() => import('./pages/History').then((m) => ({ default: m.RidePage })));
const Profile = lazy(() => import('./pages/Profile'));
const Admin = lazy(() => import('./pages/Admin'));

export default function App() {
  return (
    <Suspense fallback={<div className="pt-24"><Loading /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rides" element={<History />} />
        <Route path="/rides/:id" element={<RidePage />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
