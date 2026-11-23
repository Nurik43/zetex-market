import { locale, t } from './i18n';

/** 1234567 → «1 234 567» */
export const num = (n) => Number(n || 0).toLocaleString(locale());
/** 1234567 → «1 234 567 сум» */
export const money = (n) => `${num(n)} ${t('сум')}`;

/** «245 000 сум/мес» (строка из каталога) → с переводом единиц */
export const monthly = (s) => (s ? String(s).replace('сум/мес', t('сум/мес')) : s);
