import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { CallOverlay } from './components/CallOverlay';
import { Loading } from './components/ui';
import Home from './pages/Home';

const Connect = lazy(() => import('./pages/Connect'));
const Chats = lazy(() => import('./pages/Chats'));
const ChatPage = lazy(() => import('./pages/Chats').then((m) => ({ default: m.ChatPage })));
const Calls = lazy(() => import('./pages/Calls'));
const History = lazy(() => import('./pages/History'));
const Tariffs = lazy(() => import('./pages/Tariffs'));
const Internet = lazy(() => import('./pages/Internet'));
const Profile = lazy(() => import('./pages/Profile'));
const Admin = lazy(() => import('./pages/Admin'));

export default function App() {
  return (
    <Suspense fallback={<div className="pt-24"><Loading /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/chats" element={<Chats />} />
        <Route path="/chats/:number" element={<ChatPage />} />
        <Route path="/calls" element={<Calls />} />
        <Route path="/history" element={<History />} />
        <Route path="/tariffs" element={<Tariffs />} />
        <Route path="/internet" element={<Internet />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CallOverlay />
    </Suspense>
  );
}
