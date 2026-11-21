/** PIN code prefixes → state (India Post postal circles). Used in code and, as pin_state(), in SQL. */
export const PIN2: Record<string, string> = {
	'11': 'Delhi', '12': 'Haryana', '13': 'Haryana', '14': 'Punjab', '15': 'Punjab', '16': 'Punjab', '17': 'Himachal Pradesh', '18': 'Jammu and Kashmir', '19': 'Jammu and Kashmir',
	'20': 'Uttar Pradesh', '21': 'Uttar Pradesh', '22': 'Uttar Pradesh', '23': 'Uttar Pradesh', '24': 'Uttar Pradesh', '25': 'Uttar Pradesh', '26': 'Uttar Pradesh', '27': 'Uttar Pradesh', '28': 'Uttar Pradesh',
	'30': 'Rajasthan', '31': 'Rajasthan', '32': 'Rajasthan', '33': 'Rajasthan', '34': 'Rajasthan', '36': 'Gujarat', '37': 'Gujarat', '38': 'Gujarat', '39': 'Gujarat',
	'40': 'Maharashtra', '41': 'Maharashtra', '42': 'Maharashtra', '43': 'Maharashtra', '44': 'Maharashtra', '45': 'Madhya Pradesh', '46': 'Madhya Pradesh', '47': 'Madhya Pradesh', '48': 'Madhya Pradesh', '49': 'Chhattisgarh',
	'50': 'Telangana', '51': 'Andhra Pradesh', '52': 'Andhra Pradesh', '53': 'Andhra Pradesh', '56': 'Karnataka', '57': 'Karnataka', '58': 'Karnataka', '59': 'Karnataka',
	'60': 'Tamil Nadu', '61': 'Tamil Nadu', '62': 'Tamil Nadu', '63': 'Tamil Nadu', '64': 'Tamil Nadu', '67': 'Kerala', '68': 'Kerala', '69': 'Kerala',
	'70': 'West Bengal', '71': 'West Bengal', '72': 'West Bengal', '73': 'West Bengal', '74': 'West Bengal', '75': 'Odisha', '76': 'Odisha', '77': 'Odisha', '78': 'Assam', '79': 'North East',
	'80': 'Bihar', '81': 'Bihar', '82': 'Bihar', '83': 'Jharkhand', '84': 'Bihar', '85': 'Bihar',
};
export const PIN3: Record<string, string> = {
	'160': 'Chandigarh', '194': 'Ladakh', '246': 'Uttarakhand', '247': 'Uttarakhand', '248': 'Uttarakhand', '249': 'Uttarakhand', '262': 'Uttarakhand', '263': 'Uttarakhand',
	'403': 'Goa', '605': 'Puducherry', '737': 'Sikkim', '744': 'Andaman and Nicobar', '790': 'Arunachal Pradesh', '791': 'Arunachal Pradesh', '792': 'Arunachal Pradesh',
	'793': 'Meghalaya', '794': 'Meghalaya', '795': 'Manipur', '796': 'Mizoram', '797': 'Nagaland', '798': 'Nagaland', '799': 'Tripura',
	'814': 'Jharkhand', '815': 'Jharkhand', '816': 'Jharkhand', '822': 'Jharkhand', '825': 'Jharkhand', '826': 'Jharkhand', '827': 'Jharkhand', '828': 'Jharkhand', '829': 'Jharkhand',
};

/** SQL for pin_state(pin): the state of a six-digit PIN code, or null. */
export function pinStateSql(): string {
	const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
	const c3 = Object.entries(PIN3).map(([k, v]) => `when ${lit(k)} then ${lit(v)}`).join(' ');
	const c2 = Object.entries(PIN2).map(([k, v]) => `when ${lit(k)} then ${lit(v)}`).join(' ');
	return `create or replace function pin_state(p text) returns text language sql immutable parallel safe as $f$
  select case when p ~ '^[1-9][0-9]{5}$' then coalesce(case substr(p, 1, 3) ${c3} end, case substr(p, 1, 2) ${c2} end) end
$f$;`;
}
