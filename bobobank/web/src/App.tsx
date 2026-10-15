import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { RouteErrorBoundary } from './components/ErrorBoundary';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Register })));
const Shell = lazy(() => import('./app/Shell'));
const HomePage = lazy(() => import('./app/Home'));
const CardPage = lazy(() => import('./app/CardPage'));
const IssueCard = lazy(() => import('./app/IssueCard'));
const AccountPage = lazy(() => import('./app/AccountPage'));
const OpenAccount = lazy(() => import('./app/OpenAccount'));
const Payments = lazy(() => import('./app/Payments'));
const Transfer = lazy(() => import('./app/Transfer'));
const Exchange = lazy(() => import('./app/Exchange'));
const History = lazy(() => import('./app/History'));
const Operation = lazy(() => import('./app/Operation'));
const Analytics = lazy(() => import('./app/Analytics'));
const Bonus = lazy(() => import('./app/Bonus'));
const Savings = lazy(() => import('./app/Savings'));
const Credits = lazy(() => import('./app/Credits'));
const Apply = lazy(() => import('./app/Apply'));
const LoanPage = lazy(() => import('./app/LoanPage'));
const Chat = lazy(() => import('./app/Chat'));
const Notifications = lazy(() => import('./app/Notifications'));
const Profile = lazy(() => import('./app/Profile'));
const More = lazy(() => import('./app/More'));
const SbpPay = lazy(() => import('./app/SbpPay'));
const PsyExchange = lazy(() => import('./app/GosPages').then((m) => ({ default: m.PsyExchange })));
const Treasury = lazy(() => import('./app/GosPages').then((m) => ({ default: m.Treasury })));
const Invest = lazy(() => import('./app/Invest'));
const StockPage = lazy(() => import('./app/Invest').then((m) => ({ default: m.StockPage })));
const GosPay = lazy(() => import('./app/GosPages').then((m) => ({ default: m.GosPay })));
const Admin = lazy(() => import('./admin/Admin'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <RouteErrorBoundary>
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/admin/*" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="/sbp/pay" element={<RequireAuth><SbpPay /></RequireAuth>} />
        <Route path="/gos/pay" element={<RequireAuth><GosPay /></RequireAuth>} />
        <Route path="/app" element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="cards/new" element={<IssueCard />} />
          <Route path="cards/:id" element={<CardPage />} />
          <Route path="accounts/new" element={<OpenAccount />} />
          <Route path="accounts/:id" element={<AccountPage />} />
          <Route path="payments" element={<Payments />} />
          <Route path="transfer/:type" element={<Transfer />} />
          <Route path="exchange" element={<Exchange />} />
          <Route path="exchange/psy" element={<PsyExchange />} />
          <Route path="treasury" element={<Treasury />} />
          <Route path="invest" element={<Invest />} />
          <Route path="invest/:ticker" element={<StockPage />} />
          <Route path="history" element={<History />} />
          <Route path="history/:id" element={<Operation />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="bonus" element={<Bonus />} />
          <Route path="savings" element={<Savings />} />
          <Route path="credits" element={<Credits />} />
          <Route path="credits/apply/:product" element={<Apply />} />
          <Route path="loans/:id" element={<LoanPage />} />
          <Route path="chat" element={<Chat />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="profile" element={<Profile />} />
          <Route path="more" element={<More />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </RouteErrorBoundary>
  );
}
