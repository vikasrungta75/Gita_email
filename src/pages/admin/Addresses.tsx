import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdContentCopy, MdEdit, MdRestore, MdSearch, MdWarningAmber } from 'react-icons/md';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, Loader, PageHead, Story } from '../../components/ui';
import { COLORS, ago } from '../../lib/format';

/**
 * Gita Press head office and branches, from the official Hindi list. The Hindi address is the correct one; the English
 * is kept in step with it. These are the addresses given in replies and under every reply.
 */
export default function Addresses() {
	const { can } = useAuth();
	const { data, isLoading } = useQuery({ queryKey: ['directory'], queryFn: () => api('/settings/directory') });
	const [q, setQ] = useState('');
	const toast = useToast();
	if (isLoading || !data) return <Loader />;
	const entries: any[] = data.entries;
	const shown = entries.filter((e) => !q || `${e.city} ${e.city_hi} ${e.address} ${e.address_hi} ${e.pin} ${e.phones.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
	const edited = entries.filter((e) => e.edited?.length).length;
	const check = entries.filter((e) => e.needs_english_check);
	const copyAll = async () => {
		const text = entries.map((e) => `${e.city_hi}: ${e.address_hi} ${e.pin}\n${e.city}: ${e.address} ${e.pin}\nPhone: ${e.phones.join(', ')}${e.email ? ` · ${e.email}` : ''}`).join('\n\n');
		await navigator.clipboard.writeText(`${text}\n\n${data.postNoteHi}\n${data.postNote}`);
		toast('All addresses copied');
	};
	return (
		<>
			<PageHead kw="Addresses" rest="(head office and branches)"
				sub="Given to readers who ask for an address and printed under every reply. The Hindi address is the official one; keep the English in step with it."
				actions={<button className="btn" onClick={copyAll}><MdContentCopy /> Copy all</button>} />
			<Story
				head={<>{entries.length} Gita Press locations: the head office in Gorakhpur and {entries.length - 1} branches and shops.</>}
				points={[
					<>{edited ? `${edited} corrected here; the rest as on the official list.` : 'All as on the official list.'}</>,
					check.length ? <span style={{ color: COLORS.amber }}>English to check against the new Hindi address: {check.map((e) => e.city).join(', ')}. Until then, replies follow the Hindi.</span> : <>English and Hindi are in step.</>,
					<>Readers are only given @gitapress.org email addresses; other branch emails are kept for staff.</>,
				]}
			/>
			<div className="filter-strip mb-16">
				<div className="search-box"><MdSearch /><input className="input sm" placeholder="Search city, address, PIN or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search addresses" /></div>
			</div>
			<div className="grid g-2">
				{shown.map((e) => <AddressCard key={e.key} e={e} official={data.official.find((o: any) => o.key === e.key)} canEdit={can('manager')} />)}
			</div>
		</>
	);
}

function AddressCard({ e, official, canEdit }: { e: any; official: any; canEdit: boolean }) {
	const toast = useToast();
	const qc = useQueryClient();
	const [edit, setEdit] = useState<any>(null);
	const save = useMutation({
		mutationFn: (body: any) => api('/settings/directory', { method: 'PUT', body: { entries: [{ key: e.key, ...body }] } }),
		onSuccess: (_r, body: any) => { qc.invalidateQueries({ queryKey: ['directory'] }); setEdit(null); toast(body.reset ? `${e.city}: back to the official list` : `${e.city} saved`); },
		onError: (err: any) => toast(err.message, 'error'),
	});
	const start = () => setEdit({ address_hi: e.address_hi, address: e.address, pin: e.pin, phones: e.phones.join(', '), email: e.email || '', staff_email: e.staff_email || '', englishChecked: false });
	const hiChanged = edit && edit.address_hi.trim() !== e.address_hi;
	const enChanged = edit && edit.address.trim() !== e.address;
	const was = (k: string) => (e.edited?.includes(k) ? <span className="xs faint" title={`Official list: ${Array.isArray(official?.[k]) ? official[k].join(', ') : official?.[k] || '(none)'}`}> · corrected</span> : null);
	return (
		<Card accent={e.needs_english_check ? COLORS.amber : e.head_office ? COLORS.pink : COLORS.teal}
			title={<h2>{e.city_hi} <span className="faint" style={{ fontWeight: 500 }}>· {e.city}</span></h2>}
			sub={[e.head_office && 'Head office: books by post and abroad go only from here', e.no_stock && 'Address only (no stock in Gita Mail)', e.state].filter(Boolean).join(' · ')}
			actions={!edit && canEdit && (
				<div className="row gap-4">
					{e.edited?.length > 0 && <button className="btn ghost sm" title="Use the official list again" onClick={() => confirm(`Put ${e.city} back to the official list?`) && save.mutate({ reset: true })}><MdRestore /> Official</button>}
					<button className="btn sm" onClick={start}><MdEdit /> Edit</button>
				</div>
			)}>
			{!edit ? (
				<div className="kv">
					<span className="k">पता (official)</span><span style={{ fontWeight: 600 }}>{e.address_hi} {e.pin}{was('address_hi')}</span>
					<span className="k">English</span>
					<span>{e.address} {e.pin}{was('address')}
						{e.needs_english_check && <div className="xs row gap-4" style={{ color: COLORS.amber }}><MdWarningAmber /> Hindi was changed: check this matches it{canEdit && <button className="btn ghost sm" onClick={() => save.mutate({ englishChecked: true })}>It matches</button>}</div>}
					</span>
					<span className="k">Phone</span><span className="mono small">{e.phones.join(', ')}{was('phones')}</span>
					<span className="k">Email for readers</span><span className="small">{e.email || <span className="faint">none</span>}{was('email')}</span>
					{e.staff_email && <><span className="k">Staff-only email</span><span className="small faint">{e.staff_email}</span></>}
					{e.updated_at && <><span className="k">Last corrected</span><span className="small faint">{ago(e.updated_at)}</span></>}
				</div>
			) : (
				<div className="col gap-12">
					<div className="field"><label>पता: Hindi (official)</label>
						<textarea className="input" rows={2} value={edit.address_hi} onChange={(x) => setEdit({ ...edit, address_hi: x.target.value })} /></div>
					<div className="field"><label>English</label>
						<textarea className="input" rows={2} value={edit.address} onChange={(x) => setEdit({ ...edit, address: x.target.value })} />
						{hiChanged && !enChanged && (
							<label className="row gap-4 small mt-8" style={{ color: COLORS.amber }}>
								<input type="checkbox" checked={edit.englishChecked} onChange={(x) => setEdit({ ...edit, englishChecked: x.target.checked })} />
								The English already matches the new Hindi (otherwise it is flagged for checking, and replies follow the Hindi)
							</label>
						)}
					</div>
					<div className="grid g-2">
						<div className="field"><label>PIN code</label><input className="input" value={edit.pin} onChange={(x) => setEdit({ ...edit, pin: x.target.value })} /></div>
						<div className="field"><label>Phone numbers (separate with commas)</label><input className="input" value={edit.phones} onChange={(x) => setEdit({ ...edit, phones: x.target.value })} /></div>
						<div className="field"><label>Email for readers (@gitapress.org)</label><input className="input" value={edit.email} onChange={(x) => setEdit({ ...edit, email: x.target.value })} /></div>
						<div className="field"><label>Staff-only email</label><input className="input" value={edit.staff_email} onChange={(x) => setEdit({ ...edit, staff_email: x.target.value })} /></div>
					</div>
					{edit.email && !/@gitapress\.org$/i.test(edit.email.trim()) && <div className="xs" style={{ color: COLORS.amber }}>Only @gitapress.org addresses are given to readers; this one will be kept as staff-only.</div>}
					<div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
						<button className="btn" onClick={() => setEdit(null)}>Cancel</button>
						<button className="btn primary" disabled={save.isPending || !edit.address_hi.trim() || !edit.address.trim()} onClick={() => save.mutate(edit)}>Save</button>
					</div>
				</div>
			)}
		</Card>
	);
}
