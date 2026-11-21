/** The Kalyan "current year": calendar year by default; the start month is set in Settings (e.g. April for April–March). */
import { emailConfig, type EmailConfig } from '../email/config';

export { emailConfig };
export function kalyanYearOf(cfg: EmailConfig, d: Date): number {
	const m = d.getUTCMonth() + 1;
	return m >= cfg.kalyanYearStartMonth ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}
