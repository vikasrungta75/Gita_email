import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './contexts/AuthContext';
import Layout from './layout/Layout';
import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import SsoCallback from './pages/auth/SsoCallback';
import MyDay from './pages/MyDay';
import AllEmail from './pages/AllEmail';
import Team from './pages/Team';
import Overview from './pages/Overview';
import Conversations, { CriticalIssues } from './pages/Conversations';
import ConversationDetail from './pages/ConversationDetail';
import Insights from './pages/Insights';
import MailSage from './pages/MailSage';
import Reports from './pages/Reports';
import Settings, { SettingsRedirect } from './pages/admin/Settings';
import Profile from './pages/Profile';
import Help from './pages/Help';
import CategoryReport from './pages/CategoryReport';
import Emails from './pages/Emails';
import StockTracking from './pages/StockTracking';
import KalyanCustomers from './pages/KalyanCustomers';
import MasterHub from './pages/admin/MasterHub';
import { Loader } from './components/ui';

function Protected({ children, min }: { children: ReactNode; min?: 'viewer' | 'analyst' | 'manager' | 'admin' }) {
	const { user, loading, can } = useAuth();
	const loc = useLocation();
	if (loading) return <Loader text="Loading Gita Mail" />;
	if (!user) return <Navigate to="/auth/login" replace state={{ from: loc.pathname + loc.search }} />;
	if (min && !can(min)) return <Navigate to="/emails" replace />;
	return <>{children}</>;
}

function Home() {
	return <Navigate to="/emails" replace />;
}

export default function App() {
	const { user, loading } = useAuth();
	return (
		<Routes>
			<Route path="/auth/login" element={!loading && user ? <Navigate to="/emails" replace /> : <Login />} />
			<Route path="/auth/forgot-password" element={<ForgotPassword />} />
			<Route path="/auth/reset-password" element={<ResetPassword />} />
			<Route path="/auth/sso" element={<SsoCallback />} />
			{/* Ravity IAM reset links (same path rfleet uses) */}
			<Route path="/home" element={<ResetPassword />} />
			<Route element={<Protected><Layout /></Protected>}>
				<Route path="/" element={<Home />} />
				<Route path="/overview" element={<Overview />} />
				<Route path="/my-day" element={<MyDay />} />
				<Route path="/all-email" element={<AllEmail />} />
				<Route path="/category-report" element={<CategoryReport />} />
				<Route path="/help" element={<Help />} />
				<Route path="/emails" element={<Emails />} />
				<Route path="/proposals" element={<Navigate to="/emails?tab=bulk" replace />} />
				<Route path="/replies" element={<Navigate to="/emails" replace />} />
				<Route path="/team" element={<Protected min="manager"><Team /></Protected>} />
				<Route path="/critical" element={<CriticalIssues />} />
				<Route path="/conversations" element={<Conversations />} />
				<Route path="/conversations/:id" element={<ConversationDetail />} />
				<Route path="/customers" element={<Navigate to="/kalyan-customers" replace />} />
				<Route path="/customers/:id" element={<Navigate to="/kalyan-customers" replace />} />
				<Route path="/actions" element={<Navigate to="/emails" replace />} />
				<Route path="/insights" element={<Insights />} />
				<Route path="/mail-sage" element={<MailSage />} />
				<Route path="/alerts" element={<Navigate to="/emails?tab=all&criticality=critical" replace />} />
				<Route path="/reports" element={<Reports />} />
				<Route path="/profile" element={<Profile />} />
				<Route path="/admin/mailboxes" element={<SettingsRedirect tab="mailboxes" />} />
				<Route path="/admin/users" element={<SettingsRedirect tab="users" />} />
				<Route path="/admin/settings" element={<Protected min="analyst"><Settings /></Protected>} />
				<Route path="/admin/addresses" element={<SettingsRedirect tab="master" sub="addresses" />} />
				<Route path="/stock-tracking" element={<Protected min="analyst"><StockTracking /></Protected>} />
				<Route path="/kalyan-customers" element={<Protected min="analyst"><KalyanCustomers /></Protected>} />
				<Route path="/admin/master" element={<Protected min="analyst"><MasterHub /></Protected>} />
				<Route path="/uploads" element={<Navigate to="/stock-tracking?tab=all" replace />} />
				<Route path="/admin/customers" element={<Navigate to="/kalyan-customers" replace />} />
				<Route path="/inventory" element={<Navigate to="/stock-tracking" replace />} />
				<Route path="/admin/processing" element={<SettingsRedirect tab="status" />} />
				<Route path="/admin/audit" element={<SettingsRedirect tab="audit" />} />
				<Route path="*" element={<Navigate to="/emails" replace />} />
			</Route>
		</Routes>
	);
}
