/**
 * Gita Press, Gorakhpur: own shops and branches. Master list taken from the official Hindi branch list
 * (गीताप्रेस, गोरखपुरकी निजी दूकानें / शाखाएँ), written out in English and Hindi. Admins can still correct any
 * field in Settings → Reply drafts; a saved value replaces the one here.
 *
 * Also: which branch a stock sheet belongs to, and which branch is nearest to a reader (city, PIN code or state).
 */

export interface DirectoryEntry {
	key: string;
	city: string;
	city_hi: string;
	state: string;
	address: string;
	address_hi: string;
	pin: string;
	phones: string[];
	/** official @gitapress.org address, shown to readers */
	email?: string;
	/** other addresses found on the branch's own stock sheet (Gmail etc.): staff only, never in replies */
	staff_email?: string;
	/** has no stock sheet (Kathmandu): address only */
	no_stock?: boolean;
	head_office?: boolean;
	/** the Hindi address was changed after the English one; the English should be checked against it */
	needs_english_check?: boolean;
	/** a field here differs from the official list because staff corrected it */
	edited?: string[];
	updated_at?: string;
}

/** A correction saved in Settings → Addresses (only the fields that differ from the official list). */
export interface DirectoryOverride {
	key: string;
	address?: string;
	address_hi?: string;
	pin?: string;
	phones?: string[];
	email?: string;
	staff_email?: string;
	needs_english_check?: boolean;
	updated_at?: string;
}
export const EDITABLE = ['address', 'address_hi', 'pin', 'phones', 'email', 'staff_email'] as const;

export const HQ_KEY = 'gorakhpur';
export const POST_NOTE = 'Books can be sent by post and abroad only from Gorakhpur.';
export const POST_NOTE_HI = 'डाकद्वारा एवं विदेशोंमें पुस्तकें भेजनेकी व्यवस्था केवल गोरखपुरमें है।';
export const ONLINE_NOTE = 'To buy any Gita Press book online, log in at www.gitapress.org. Orders can also be booked by email: booksales@gitapress.org';
export const HQ_CONTACT = { phones: ['+91-9235400242', '+91-9235400244'], whatsapp: '+91-9235400244', email: 'booksales@gitapress.org', website: 'www.gitapress.org' };

export const DIRECTORY: DirectoryEntry[] = [
	{ key: 'gorakhpur', city: 'Gorakhpur', city_hi: 'गोरखपुर', state: 'Uttar Pradesh', address: 'Gita Press Road, Gorakhpur', address_hi: 'गीताप्रेस रोड, गोरखपुर', pin: '273005', phones: ['8188054402', '8188054403'], email: 'booksales@gitapress.org', head_office: true },
	{ key: 'kolkata', city: 'Kolkata', city_hi: 'कोलकाता', state: 'West Bengal', address: 'Gobind Bhawan, 151, Mahatma Gandhi Road, Kolkata', address_hi: 'गोबिन्दभवन, 151, महात्मा गाँधी रोड, कोलकाता', pin: '700007', phones: ['7390050101', '9804801447', '(033) 40605293'], staff_email: 'gbk.gitapress@gmail.com' },
	{ key: 'delhi', city: 'Delhi', city_hi: 'दिल्ली', state: 'Delhi', address: '2609, Nai Sarak, Delhi', address_hi: '2609, नयी सड़क, दिल्ली', pin: '110006', phones: ['7390050102', '7289802606'] },
	{ key: 'kanpur', city: 'Kanpur', city_hi: 'कानपुर', state: 'Uttar Pradesh', address: '24/55, Birhana Road, Kanpur', address_hi: '24/55, बिरहाना रोड, कानपुर', pin: '208001', phones: ['7390050103', '9839922098', '(0512) 2352351'], email: 'kanpur@gitapress.org' },
	{ key: 'surat', city: 'Surat', city_hi: 'सूरत', state: 'Gujarat', address: '2016, Vaibhav Apartment, Bhatar Road, Surat', address_hi: '2016, वैभव एपार्टमेन्ट, भटार रोड, सूरत', pin: '395001', phones: ['7390050104', '(0261) 2238065'], email: 'surat@gitapress.org' },
	{ key: 'varanasi', city: 'Varanasi', city_hi: 'वाराणसी', state: 'Uttar Pradesh', address: '59/9, Nichibagh, Varanasi', address_hi: '59/9, नीचीबाग, वाराणसी', pin: '221001', phones: ['7390050105', '9839900745', '(0542) 2413551'], email: 'varanasi@gitapress.org' },
	{ key: 'indore', city: 'Indore', city_hi: 'इन्दौर', state: 'Madhya Pradesh', address: 'G-5, Shrivardhan, 4 R.N.T. Marg, Indore', address_hi: 'जी० ५, श्रीवर्धन, ४ आर. एन. टी. मार्ग, इन्दौर', pin: '452001', phones: ['7390050106', '8349850107', '(0731) 4381328'], email: 'indore@gitapress.org' },
	{ key: 'patna', city: 'Patna', city_hi: 'पटना', state: 'Bihar', address: 'Ashok Rajpath, Opposite Mahila Hospital, Patna', address_hi: 'अशोकराजपथ, महिला अस्पतालके सामने, पटना', pin: '800004', phones: ['7390050107', '8210494381', '(0612) 2300325'], email: 'patna@gitapress.org' },
	{ key: 'bhilwara', city: 'Bhilwara', city_hi: 'भीलवाड़ा', state: 'Rajasthan', address: 'G-7, Aakar Tower, C Block, Old RTO Road, Gandhi Nagar, Bhilwara', address_hi: 'जी ७, आकार टावर, सी ब्लाक, पुराना RTO रोड, गान्धीनगर, भीलवाड़ा', pin: '311001', phones: ['7390050108', '8955807761', '(01482) 248330'], email: 'bhilwara@gitapress.org' },
	{ key: 'haridwar', city: 'Haridwar', city_hi: 'हरिद्वार', state: 'Uttarakhand', address: 'Sabzi Mandi, Moti Bazar, Haridwar', address_hi: 'सब्जीमण्डी, मोतीबाजार, हरिद्वार', pin: '249401', phones: ['7390050109', '9119043906', '(01334) 222657'] },
	{ key: 'rishikesh', city: 'Rishikesh', city_hi: 'ऋषिकेश', state: 'Uttarakhand', address: 'Gita Bhawan, P.O. Swargashram, Rishikesh', address_hi: 'गीताभवन, पो० स्वर्गाश्रम, ऋषिकेश', pin: '249304', phones: ['7390050110', '6397500736'], staff_email: 'gitabhawan11@gmail.com' },
	{ key: 'hyderabad', city: 'Hyderabad', city_hi: 'हैदराबाद', state: 'Telangana', address: '41, 4-4-1, Dilshad Plaza, Sultan Bazar, Hyderabad', address_hi: '41, 4-4-1, दिलशाद प्लाजा, सुल्तान बाजार, हैदराबाद', pin: '500095', phones: ['7390050091', '9573650611', '(040) 24758311'], email: 'hyderabad@gitapress.org' },
	{ key: 'mumbai', city: 'Mumbai', city_hi: 'मुम्बई', state: 'Maharashtra', address: 'Shop No. 6, Bay View Tower, Chira Bazar, Mumbai', address_hi: 'दूकान नं. 6, बे व्यू टॉवर, चीरा बाजार, मुम्बई', pin: '400002', phones: ['7390050092', '9768954885', '(022) 35062886'] },
	{ key: 'bengaluru', city: 'Bengaluru', city_hi: 'बेंगलुरु', state: 'Karnataka', address: '7/3, Second Cross, Lalbagh Road, Bengaluru', address_hi: '7/3, सेकेण्ड क्रास, लालबाग रोड, बेंगलुरु', pin: '560027', phones: ['7390050093', '9341891495'], staff_email: 'anand.gitapress@gmail.com' },
	{ key: 'chennai', city: 'Chennai', city_hi: 'चेन्नई', state: 'Tamil Nadu', address: 'Bougainvillea Apartments, Anna Nagar (East), Chennai', address_hi: 'बाउगेनविला अपार्टमेन्ट्स, अन्ना नगर (पूर्व), चेन्नई', pin: '600102', phones: ['7390050094', '7200050708'], email: 'chennai@gitapress.org' },
	{ key: 'cuttack', city: 'Cuttack', city_hi: 'कटक', state: 'Odisha', address: 'Bhartia Towers, Badambadi, Cuttack', address_hi: 'भरतिया टावर्स, बादाम बाड़ी, कटक', pin: '753009', phones: ['7390050095', '8093091800', '(0671) 2335481'] },
	{ key: 'raipur', city: 'Raipur', city_hi: 'रायपुर', state: 'Chhattisgarh', address: 'Mittal Complex, Ganjpara, Telghani Naka Chowk, Raipur (Chhattisgarh)', address_hi: 'मित्तल कॉम्प्लेक्स, गंजपारा, तेलघानी नाका चौक, रायपुर (छत्तीसगढ़)', pin: '492009', phones: ['7390050096', '7879845886', '(0771) 4034430'], email: 'raipur@gitapress.org' },
	{ key: 'jalgaon', city: 'Jalgaon', city_hi: 'जलगाँव', state: 'Maharashtra', address: '7, Bhimsingh Market, Near Railway Station, Jalgaon', address_hi: '7, भीमसिंह मार्केट, रेलवे स्टेशनके पास, जलगाँव', pin: '425001', phones: ['7390050097', '7020118397'] },
	{ key: 'nagpur', city: 'Nagpur', city_hi: 'नागपुर', state: 'Maharashtra', address: 'Shriji Kripa Complex, 851, New Itwari Road, Nagpur', address_hi: 'श्रीजी कृपा कॉम्प्लेक्स, 851, न्यू इतवारी रोड, नागपुर', pin: '440002', phones: ['7390050098', '8830473114', '(0712) 2734354'], email: 'nagpurdukan@gitapress.org' },
	{ key: 'ranchi', city: 'Ranchi', city_hi: 'राँची', state: 'Jharkhand', address: 'Cart Sarai Road, Upper Bazar, Birla Gaddi, First Floor, Ranchi', address_hi: 'कार्ट सराय रोड, अपर बाजार, बिड़ला गद्दीके प्रथम तलपर, राँची', pin: '834001', phones: ['7390050099', '7004458358'] },
	{ key: 'kathmandu', city: 'Kathmandu', city_hi: 'काठमाडौं', state: 'Nepal', address: 'Shop No. 6, 7, 8, Madhavraj Sumargi, Kathmandu (Nepal)', address_hi: 'पसल नं० 6,7,8 माधवराज सुमार्गी, काठमाडौं (नेपाल)', pin: '44600', phones: ['(+977) 8681493826', '9823490038'], email: 'nepal@gitapress.org', no_stock: true },
];

export const BY_KEY = new Map(DIRECTORY.map((d) => [d.key, d]));

/**
 * The directory with corrections from Settings applied. The Hindi address is the official one; the English is kept
 * in step with it. Older saved settings (settings.branches: address, phone, email per city) still apply.
 */
export function resolveDirectory(settings?: any): DirectoryEntry[] {
	const over = new Map<string, DirectoryOverride>(((settings?.directory || []) as DirectoryOverride[]).filter((o) => o?.key).map((o) => [o.key, o]));
	const legacy = new Map<string, any>(((settings?.directory ? [] : settings?.branches || []) as any[]).filter((b) => b?.city).map((b) => [String(b.city).toLowerCase(), b]));
	return DIRECTORY.map((d) => {
		const e: DirectoryEntry = { ...d, phones: [...d.phones], edited: [] };
		const o = over.get(d.key);
		if (o) {
			for (const k of EDITABLE) {
				const v = (o as any)[k];
				if (v === undefined || v === null) continue;
				(e as any)[k] = k === 'phones' ? [...v] : v;
				e.edited!.push(k);
			}
			e.needs_english_check = !!o.needs_english_check;
			e.updated_at = o.updated_at;
		}
		const l = legacy.get(d.city.toLowerCase());
		if (l) {
			const addr = String(l.address || '').trim();
			const pin = addr.match(/\b(\d{5,6})\s*$/)?.[1];
			if (addr && addr !== `${d.address} ${d.pin}`) { e.address = pin ? addr.replace(/\s*\d{5,6}\s*$/, '') : addr; if (pin) e.pin = pin; e.edited!.push('address'); }
			const ahi = String(l.address_hi || '').trim();
			if (ahi && ahi !== `${d.address_hi} ${d.pin}`) { e.address_hi = ahi.replace(/\s*\d{5,6}\s*$/, ''); e.edited!.push('address_hi'); }
			const ph = String(l.phone || '').trim();
			if (ph && ph !== d.phones.join(', ')) { e.phones = ph.split(/\s*[,;]\s*/).filter(Boolean); e.edited!.push('phones'); }
			if (String(l.email || '').trim() && l.email !== (d.email || '')) { e.email = String(l.email).trim(); e.edited!.push('email'); }
		}
		// a reader is only given an official @gitapress.org address
		if (e.email && !/@gitapress\.org$/i.test(e.email)) { e.staff_email = e.staff_email || e.email; e.email = undefined; }
		return e;
	});
}
export const locationLabel = (key: string) => (BY_KEY.get(key)?.city || key.replace(/^./, (c) => c.toUpperCase()));

/** Other names readers and Tally use for each place. */
export const ALIASES: Record<string, string[]> = {
	gorakhpur: ['gorakhpur', 'गोरखपुर', 'gita press road', 'head office', 'govind bhawan karyalaya'],
	kolkata: ['kolkata', 'calcutta', 'कोलकाता', 'कलकत्ता', 'howrah'],
	delhi: ['delhi', 'new delhi', 'दिल्ली', 'नई दिल्ली', 'nai sarak', 'chandni chowk'],
	kanpur: ['kanpur', 'कानपुर', 'cawnpore'],
	surat: ['surat', 'सूरत'],
	varanasi: ['varanasi', 'banaras', 'benares', 'kashi', 'वाराणसी', 'काशी', 'बनारस', 'kasi'],
	indore: ['indore', 'इंदौर', 'इन्दौर'],
	patna: ['patna', 'पटना'],
	bhilwara: ['bhilwara', 'भीलवाड़ा', 'भीलवाडा'],
	haridwar: ['haridwar', 'hardwar', 'हरिद्वार'],
	rishikesh: ['rishikesh', 'ऋषिकेश', 'swargashram', 'swarg ashram', 'gita bhawan', 'गीताभवन'],
	hyderabad: ['hyderabad', 'secunderabad', 'हैदराबाद'],
	mumbai: ['mumbai', 'bombay', 'मुंबई', 'मुम्बई', 'thane', 'navi mumbai'],
	bengaluru: ['bengaluru', 'bangalore', 'banglore', 'बेंगलुरु', 'बैंगलोर', 'बंगलौर'],
	chennai: ['chennai', 'madras', 'चेन्नई'],
	cuttack: ['cuttack', 'cuttuck', 'कटक', 'bhubaneswar', 'bhubaneshwar'],
	raipur: ['raipur', 'रायपुर'],
	jalgaon: ['jalgaon', 'जलगाँव', 'जलगांव'],
	nagpur: ['nagpur', 'नागपुर'],
	ranchi: ['ranchi', 'राँची', 'रांची'],
	kathmandu: ['kathmandu', 'काठमांडू', 'काठमाडौं', 'nepal', 'नेपाल'],
};

const norm = (s: string) => ` ${s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim()} `;

/** Which place a text names (first match wins, longest alias first). */
export function placeInText(text: string): string | null {
	const t = norm(text);
	const pairs = Object.entries(ALIASES).flatMap(([k, list]) => list.map((a) => [k, a] as const)).sort((a, b) => b[1].length - a[1].length);
	for (const [k, a] of pairs) if (t.includes(norm(a))) return k;
	return null;
}

/** Stock sheet → branch: the most common godown name decides, then the sheet name. */
export function locationForSheet(sheet: string, godowns: string[]): string | null {
	const counts = new Map<string, number>();
	for (const g of godowns) {
		const k = placeInText(g.replace(/location|branch|godown|retail|whole ?sale|default/gi, ' '));
		if (k) counts.set(k, (counts.get(k) || 0) + 1);
	}
	const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
	return best?.[0] || placeInText(sheet);
}

// ── Nearest branch ─────────────────────────────────────────────────────────

/** 3-digit PIN prefix ranges → nearest branch with stock (checked first, in order). */
const PIN3: [number, number, string][] = [
	// Uttar Pradesh and Uttarakhand, split by region
	[201, 205, 'delhi'], [206, 210, 'kanpur'], [211, 212, 'varanasi'], [221, 223, 'varanasi'], [224, 224, 'gorakhpur'], [225, 229, 'kanpur'],
	[230, 233, 'varanasi'], [241, 245, 'delhi'], [246, 248, 'haridwar'], [249, 249, 'haridwar'], [250, 250, 'delhi'], [251, 251, 'haridwar'],
	[261, 262, 'kanpur'], [263, 263, 'haridwar'], [271, 275, 'gorakhpur'], [276, 277, 'varanasi'], [281, 283, 'delhi'], [284, 285, 'kanpur'],
	// Rajasthan: Alwar and Bharatpur nearer Delhi
	[301, 301, 'delhi'], [321, 321, 'delhi'],
	// Maharashtra
	[400, 421, 'mumbai'], [422, 422, 'mumbai'], [423, 425, 'jalgaon'], [431, 431, 'jalgaon'], [440, 445, 'nagpur'],
	// Madhya Pradesh
	[474, 477, 'kanpur'], [480, 484, 'nagpur'], [485, 486, 'varanasi'], [487, 488, 'nagpur'],
	// Andhra Pradesh
	[515, 516, 'bengaluru'], [517, 517, 'chennai'], [524, 524, 'chennai'], [530, 535, 'cuttack'],
	// Tamil Nadu west → Bengaluru
	[635, 635, 'bengaluru'], [638, 643, 'bengaluru'],
	// Jharkhand inside Bihar ranges
	[814, 816, 'ranchi'], [822, 822, 'ranchi'], [825, 835, 'ranchi'],
];

const STATE_BRANCH: Record<string, string> = {
	Delhi: 'delhi', Haryana: 'delhi', Punjab: 'delhi', Chandigarh: 'delhi', 'Himachal Pradesh': 'haridwar', 'Jammu and Kashmir': 'delhi', Ladakh: 'delhi',
	'Uttar Pradesh': 'gorakhpur', Uttarakhand: 'haridwar', Rajasthan: 'bhilwara', Gujarat: 'surat', 'Dadra and Nagar Haveli and Daman and Diu': 'surat',
	Maharashtra: 'mumbai', Goa: 'mumbai', 'Madhya Pradesh': 'indore', Chhattisgarh: 'raipur', Telangana: 'hyderabad', 'Andhra Pradesh': 'hyderabad',
	Karnataka: 'bengaluru', Kerala: 'bengaluru', 'Tamil Nadu': 'chennai', Puducherry: 'chennai', 'West Bengal': 'kolkata', Sikkim: 'kolkata', Odisha: 'cuttack',
	Assam: 'kolkata', 'North East': 'kolkata', 'Arunachal Pradesh': 'kolkata', Meghalaya: 'kolkata', Manipur: 'kolkata', Mizoram: 'kolkata', Nagaland: 'kolkata',
	Tripura: 'kolkata', 'Andaman and Nicobar': 'kolkata', Bihar: 'patna', Jharkhand: 'ranchi', Nepal: 'kathmandu',
};
const PIN2_STATE: Record<string, string> = {
	'11': 'Delhi', '12': 'Haryana', '13': 'Haryana', '14': 'Punjab', '15': 'Punjab', '16': 'Punjab', '17': 'Himachal Pradesh', '18': 'Jammu and Kashmir', '19': 'Jammu and Kashmir',
	'20': 'Uttar Pradesh', '21': 'Uttar Pradesh', '22': 'Uttar Pradesh', '23': 'Uttar Pradesh', '24': 'Uttar Pradesh', '25': 'Uttar Pradesh', '26': 'Uttar Pradesh', '27': 'Uttar Pradesh', '28': 'Uttar Pradesh',
	'30': 'Rajasthan', '31': 'Rajasthan', '32': 'Rajasthan', '33': 'Rajasthan', '34': 'Rajasthan', '36': 'Gujarat', '37': 'Gujarat', '38': 'Gujarat', '39': 'Gujarat',
	'40': 'Maharashtra', '41': 'Maharashtra', '42': 'Maharashtra', '43': 'Maharashtra', '44': 'Maharashtra', '45': 'Madhya Pradesh', '46': 'Madhya Pradesh', '47': 'Madhya Pradesh', '48': 'Madhya Pradesh', '49': 'Chhattisgarh',
	'50': 'Telangana', '51': 'Andhra Pradesh', '52': 'Andhra Pradesh', '53': 'Andhra Pradesh', '56': 'Karnataka', '57': 'Karnataka', '58': 'Karnataka', '59': 'Karnataka',
	'60': 'Tamil Nadu', '61': 'Tamil Nadu', '62': 'Tamil Nadu', '63': 'Tamil Nadu', '64': 'Tamil Nadu', '67': 'Kerala', '68': 'Kerala', '69': 'Kerala',
	'70': 'West Bengal', '71': 'West Bengal', '72': 'West Bengal', '73': 'West Bengal', '74': 'West Bengal', '75': 'Odisha', '76': 'Odisha', '77': 'Odisha', '78': 'Assam', '79': 'North East',
	'80': 'Bihar', '81': 'Bihar', '82': 'Bihar', '83': 'Jharkhand', '84': 'Bihar', '85': 'Bihar',
};

export interface Place { city?: string | null; state?: string | null; pin?: string | null; address?: string | null; country?: string | null; text?: string | null }

/** The branch nearest to a reader, and why. Gorakhpur counts as a branch for readers in eastern UP. */
export function nearestBranch(place: Place): { key: string; why: string } | null {
	const named = placeInText(`${place.city || ''} ${place.address || ''}`);
	if (named) return { key: named, why: `the reader is in ${BY_KEY.get(named)?.city}` };
	const pin = (place.pin || `${place.address || ''} ${place.text || ''}`.match(/\b([1-9]\d{2})\s?(\d{3})\b/)?.slice(1).join('') || '').replace(/\s/g, '');
	if (/^[1-9]\d{5}$/.test(pin)) {
		const p3 = Number(pin.slice(0, 3));
		const hit = PIN3.find(([a, b]) => p3 >= a && p3 <= b);
		if (hit) return { key: hit[2], why: `PIN code ${pin}` };
		const st = PIN2_STATE[pin.slice(0, 2)];
		if (st && STATE_BRANCH[st]) return { key: STATE_BRANCH[st], why: `PIN code ${pin} (${st})` };
	}
	if (/nepal|नेपाल/i.test(`${place.country || ''} ${place.state || ''}`)) return { key: 'kathmandu', why: 'the reader is in Nepal' };
	const st = Object.keys(STATE_BRANCH).find((s) => (place.state || '').toLowerCase() === s.toLowerCase());
	if (st) return { key: STATE_BRANCH[st], why: `the reader is in ${st}` };
	const inText = placeInText(place.text || '');
	if (inText) return { key: inText, why: `the email names ${BY_KEY.get(inText)?.city}` };
	return null;
}

/** Is the reader outside India (then only Gorakhpur can send books)? */
export function isAbroad(place: Place): boolean {
	const c = (place.country || '').trim().toLowerCase();
	return !!c && !/^(india|bharat|भारत|in)$/.test(c);
}

/** The reader is asking for an address, shop or phone number (not giving their own address). */
export const ADDRESS_INTENT = /\b(your|gita ?press'?s?|the)\s+(address(es)?|shops?|branch(es)?|stores?|outlets?|showrooms?|book ?shops?|dukan)\b|\baddress(es)? (of|for)\b|\bshare (the |your )?address(es)?\b|\b(branch(es)?|shops?|dukan|outlets?|showrooms?|book ?stores?|book ?shops?)\s+(in|at|near)\b|\bnearest (branch|shop|store|outlet|dukan)\b|\bwhere (can|do|could) (i|we) (buy|get|purchase|find)\b|\b(contact|phone|mobile|telephone) (no\.?|number|numbers|details) (of|for)\b|(का|के|की) पता|पता (बताइए|बताइये|बताएं|बताएँ|बतायें|दीजिए|दीजिये|दें|भेजें|भेजिए|क्या है)|शाखा|शाखाओं|दुकान|दूकान|कहाँ (मिलेगी|मिलेगा|मिलती|मिलते|से (खरीद|मिल|ले))|कहां (मिलेगी|मिलेगा|मिलती|से)|संपर्क (नंबर|सूत्र)|फोन नंबर/i;

/** One line for a reply. */
export function entryText(d: DirectoryEntry, hindi = false, withPublicEmail = true): string {
	const name = hindi ? `${d.city_hi}${d.head_office ? ' (मुख्य कार्यालय)' : ''}` : `${d.city}${d.head_office ? ' (head office)' : ''}`;
	const addr = hindi ? d.address_hi : d.address;
	const parts = [`${name}: ${addr} ${d.pin}`, `${hindi ? 'फोन' : 'Phone'}: ${d.phones.join(', ')}`];
	if (withPublicEmail && d.email) parts.push(`${hindi ? 'ई-मेल' : 'Email'}: ${d.email}`);
	return parts.join(' · ');
}
