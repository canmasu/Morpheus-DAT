import type { Locale } from '../locales';
import type { Messages } from './en';
import { en } from './en';
import { deDE } from './de-de';
import { esES } from './es-es';
import { esLA } from './es-la';
import { itIT } from './it-it';
import { plPL } from './pl-pl';
import { ptPT } from './pt-pt';
import { ptBR } from './pt-br';
import { idID } from './id-id';
import { msMY } from './ms-my';
import { filPH } from './fil-ph';
import { thTH } from './th-th';
import { zhCN } from './zh-cn';
import { zhTW } from './zh-tw';
import { jaJP } from './ja-jp';
import { koKR } from './ko-kr';

export const MESSAGES: Record<Locale, Messages> = {
  en,
  'de-de': deDE,
  'es-es': esES,
  'es-la': esLA,
  'it-it': itIT,
  'pl-pl': plPL,
  'pt-pt': ptPT,
  'pt-br': ptBR,
  'id-id': idID,
  'ms-my': msMY,
  'fil-ph': filPH,
  'th-th': thTH,
  'zh-cn': zhCN,
  'zh-tw': zhTW,
  'ja-jp': jaJP,
  'ko-kr': koKR,
};
