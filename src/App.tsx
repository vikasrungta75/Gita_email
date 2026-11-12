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
import Proposals from './pages/Proposals';
import Drafts from './pages/Drafts';
import Team from './pages/Team';
import Overview from './pages/Overview';
import Conversations, { CriticalIssues } from './pages/Conversations';
import ConversationDetail from './pages/ConversationDetail';
import Customers, { CustomerDetail } from './pages/Customers';
import Actions from './pages/Actions';
import Insights from './pages/Insights';
import MailSage from './pages/MailSage';
import Alerts from './pages/Alerts';
import Reports from './pages/Reports';
import Settings, { SettingsRedirect } from './pages/admin/Settings';
import CustomerDb from './pages/admin/CustomerDb';
import Profile from './pages/Profile';
import Help from './pages/Help';
import CategoryReport from './pages/CategoryReport';
import Inventory from './pages/Inventory';
import Uploads from './pages/Uploads';
import { Loader } from './components/ui';

function Protected({ children, min }: { children: ReactNode; min?: 'viewer' | 'analyst' | 'manager' | 'admin' }) {
	const { user, loading, can } = useAuth();
	const loc = useLocation();
	if (loading) return <Loader text="Loading Gita Mail" />;
	if (!user) return <Navigate to="/auth/login" replace state={{ from: loc.pathname + loc.search }} />;
	if (min && !can(min)) return <Navigate to="/overview" replace />;
	return <>{children}</>;
}

function Home() {
	const { can } = useAuth();
	return <Navigate to={can('manager') ? '/overview' : '/my-day'} replace />;
}

export default function App() {
	const { user, loading } = useAuth();
	return (
		<Routes>
			<Route path="/auth/login" element={!loading && user ? <Navigate to="/overview" replace /> : <Login />} />
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
				<Route path="/proposals" element={<Proposals />} />
				<Route path="/replies" element={<Drafts />} />
				<Route path="/team" element={<Protected min="manager"><Team /></Protected>} />
				<Route path="/critical" element={<CriticalIssues />} />
				<Route path="/conversations" element={<Conversations />} />
				<Route path="/conversations/:id" element={<ConversationDetail />} />
				<Route path="/customers" element={<Customers />} />
				<Route path="/customers/:id" element={<CustomerDetail />} />
				<Route path="/actions" element={<Actions />} />
				<Route path="/insights" element={<Insights />} />
				<Route path="/mail-sage" element={<MailSage />} />
				<Route path="/alerts" element={<Alerts />} />
				<Route path="/reports" element={<Reports />} />
				<Route path="/profile" element={<Profile />} />
				<Route path="/admin/mailboxes" element={<SettingsRedirect tab="mailboxes" />} />
				<Route path="/admin/users" element={<SettingsRedirect tab="users" />} />
				<Route path="/admin/settings" element={<Protected min="analyst"><Settings /></Protected>} />
				<Route path="/admin/addresses" element={<SettingsRedirect tab="master" sub="addresses" />} />
				<Route path="/uploads" element={<Protected min="analyst"><Uploads /></Protected>} />
				<Route path="/admin/customers" element={<Protected min="analyst"><CustomerDb /></Protected>} />
				<Route path="/inventory" element={<Protected min="analyst"><Inventory /></Protected>} />
				<Route path="/admin/processing" element={<SettingsRedirect tab="status" />} />
				<Route path="/admin/audit" element={<SettingsRedirect tab="audit" />} />
				<Route path="*" element={<Navigate to="/overview" replace />} />
			</Route>
		</Routes>
	);
}
