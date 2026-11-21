import type { IconType } from 'react-icons';
import {
	MdAutoAwesome, MdDashboard, MdForum, MdInsights, MdAssessment, MdInbox, MdSettings, MdToday, MdGroups, MdHelpOutline, MdContacts, MdInventory2, MdStorage, MdLocalShipping,
} from 'react-icons/md';

export interface MenuItem {
	id: string;
	text: string;
	path: string;
	icon: IconType;
	minRole?: 'viewer' | 'analyst' | 'manager' | 'admin';
	badge?: 'emails' | 'myday';
	/** other paths that highlight this item */
	also?: string[];
}

export const menu: { section: string; items: MenuItem[] }[] = [
	{
		section: 'Work',
		items: [
			{ id: 'emails', text: 'Emails', path: '/emails', icon: MdInbox, badge: 'emails' },
		],
	},
	{
		section: 'Data',
		items: [
			{ id: 'customerdb', text: 'Customer database', path: '/kalyan-customers', icon: MdContacts, minRole: 'analyst' },
			{ id: 'stock', text: 'Stock', path: '/stock', icon: MdInventory2, minRole: 'analyst' },
			{ id: 'tracking', text: 'Tracking', path: '/tracking', icon: MdLocalShipping, minRole: 'analyst' },
		],
	},
	{
		section: 'Management',
		items: [
			{ id: 'overview', text: 'Overview', path: '/overview', icon: MdDashboard },
			{ id: 'email', text: 'All email', path: '/all-email', also: ['/critical', '/conversations', '/category-report'], icon: MdForum },
		],
	},
	{
		section: 'Insight',
		items: [
			{ id: 'insights', text: 'Trends and insights', path: '/insights', icon: MdInsights },
			{ id: 'team', text: 'Team performance', path: '/team', icon: MdGroups, minRole: 'manager' },
			{ id: 'reports', text: 'Reports', path: '/reports', icon: MdAssessment },
		],
	},
	{
		section: 'Admin',
		items: [
			{ id: 'master', text: 'Master data', path: '/admin/master', icon: MdStorage, minRole: 'analyst' },
			{ id: 'settings', text: 'Settings', path: '/admin/settings', icon: MdSettings, minRole: 'analyst', also: ['/admin/mailboxes', '/admin/users', '/admin/processing', '/admin/audit', '/admin/addresses'] },
			{ id: 'help', text: 'Help and templates', path: '/help', icon: MdHelpOutline },
		],
	},
	{
		section: 'To decide',
		items: [
			{ id: 'myday', text: 'My day', path: '/my-day', icon: MdToday, badge: 'myday' },
			{ id: 'sage', text: 'Mail Sage', path: '/mail-sage', icon: MdAutoAwesome },
		],
	},
];

export const titleFor = (path: string) => {
	for (const s of menu) for (const i of s.items) if ([i.path, ...(i.also || [])].some((p) => path.startsWith(p))) return i.text;
	if (path.startsWith('/profile')) return 'My profile';
	if (path.startsWith('/category-report')) return 'Category report';
	if (path.startsWith('/emails')) return 'Emails';
	return 'Gita Mail';
};
