export type Locale =
  | 'en'
  | 'de-de' | 'es-es' | 'it-it' | 'pl-pl' | 'pt-pt'
  | 'es-la' | 'pt-br'
  | 'id-id' | 'ms-my' | 'fil-ph' | 'th-th' | 'zh-cn' | 'zh-tw' | 'ja-jp' | 'ko-kr';

/** Each language is named in its own language, as in the picker. `html` is the BCP 47 tag for <html lang>. */
export const LOCALES: { code: Locale; name: string; short: string; html: string; group: 'default' | 'europe' | 'latam' | 'asia' }[] = [
  { code: 'en', name: 'English', short: 'EN', html: 'en', group: 'default' },
  { code: 'de-de', name: 'Deutsch', short: 'DE', html: 'de-DE', group: 'europe' },
  { code: 'es-es', name: 'Español (España)', short: 'ES', html: 'es-ES', group: 'europe' },
  { code: 'it-it', name: 'Italiano', short: 'IT', html: 'it-IT', group: 'europe' },
  { code: 'pl-pl', name: 'Polski', short: 'PL', html: 'pl-PL', group: 'europe' },
  { code: 'pt-pt', name: 'Português (Portugal)', short: 'PT', html: 'pt-PT', group: 'europe' },
  { code: 'es-la', name: 'Español (Latinoamérica)', short: 'ES', html: 'es-419', group: 'latam' },
  { code: 'pt-br', name: 'Português (Brasil)', short: 'BR', html: 'pt-BR', group: 'latam' },
  { code: 'id-id', name: 'Bahasa Indonesia', short: 'ID', html: 'id-ID', group: 'asia' },
  { code: 'ms-my', name: 'Bahasa Melayu', short: 'MS', html: 'ms-MY', group: 'asia' },
  { code: 'fil-ph', name: 'Filipino', short: 'FIL', html: 'fil-PH', group: 'asia' },
  { code: 'th-th', name: 'ไทย', short: 'TH', html: 'th-TH', group: 'asia' },
  { code: 'zh-cn', name: '简体中文', short: '简中', html: 'zh-CN', group: 'asia' },
  { code: 'zh-tw', name: '繁體中文', short: '繁中', html: 'zh-TW', group: 'asia' },
  { code: 'ja-jp', name: '日本語', short: 'JA', html: 'ja-JP', group: 'asia' },
  { code: 'ko-kr', name: '한국어', short: 'KO', html: 'ko-KR', group: 'asia' },
];

/** Best match for the browser's languages, e.g. "pt-BR" → pt-br, "es-MX" → es-la, "zh-Hant-TW" → zh-tw, "zh-SG" → zh-cn. */
export function detectLocale(langs: readonly string[]): Locale {
  for (const raw of langs) {
    const l = raw.toLowerCase();
    const exact = LOCALES.find((x) => x.code === l || x.html.toLowerCase() === l);
    if (exact) return exact.code;
    const [lang, region] = l.split('-');
    if (lang === 'es') return region === 'es' ? 'es-es' : 'es-la';
    if (lang === 'pt') return region === 'br' ? 'pt-br' : 'pt-pt';
    if (lang === 'zh') return /tw|hk|mo|hant/.test(l) ? 'zh-tw' : 'zh-cn';
    if (lang === 'tl') return 'fil-ph';
    const byLang = LOCALES.find((x) => x.code.split('-')[0] === lang);
    if (byLang) return byLang.code;
  }
  return 'en';
}
