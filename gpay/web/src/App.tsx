import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import CheckoutPage from './checkout/Checkout';
import LinkPage from './checkout/LinkPage';
import QuittancePage from './checkout/QuittancePage';
import ReceiptPage from './checkout/ReceiptPage';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';

// The buyer-facing pages above stay in the main bundle; the cabinet, docs and admin load on demand.
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Register })));
const Docs = lazy(() => import('./docs/Docs'));
const Admin = lazy(() => import('./admin/Admin'));
const MerchantLayout = lazy(() => import('./merchant/Layout'));
const AppIndex = lazy(() => import('./merchant/Layout').then((m) => ({ default: m.AppIndex })));
const Overview = lazy(() => import('./merchant/Overview'));
const Payments = lazy(() => import('./merchant/Payments'));
const PaymentDetail = lazy(() => import('./merchant/PaymentDetail'));
const Refunds = lazy(() => import('./merchant/Pages').then((m) => ({ default: m.Refunds })));
const Analytics = lazy(() => import('./merchant/Pages').then((m) => ({ default: m.AnalyticsPage })));
const Payouts = lazy(() => import('./merchant/Pages').then((m) => ({ default: m.Payouts })));
const Links = lazy(() => import('./merchant/Links'));
const Developers = lazy(() => import('./merchant/Developers'));
const Settings = lazy(() => import('./merchant/Settings'));
const NewShop = lazy(() => import('./merchant/Settings').then((m) => ({ default: m.NewShop })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/pay/:id" element={<CheckoutPage />} />
        <Route path="/l/:slug" element={<LinkPage />} />
        <Route path="/r/:id" element={<ReceiptPage />} />
        <Route path="/q/:id" element={<QuittancePage />} />
        <Route path="/app" element={<RequireAuth><AppIndex /></RequireAuth>} />
        <Route path="/app/new" element={<RequireAuth><NewShop /></RequireAuth>} />
        <Route path="/app/:shopId" element={<RequireAuth><MerchantLayout /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="payments" element={<Payments />} />
          <Route path="payments/:pid" element={<PaymentDetail />} />
          <Route path="refunds" element={<Refunds />} />
          <Route path="links" element={<Links />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="payouts" element={<Payouts />} />
          <Route path="developers" element={<Developers />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
