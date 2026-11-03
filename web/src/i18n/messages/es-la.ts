import type { Messages } from './en';
import { esES } from './es-es';

/** Latin American Spanish: Spain's text with regional wording ("billetera", "computadora", "ingresa"). */
export const esLA: Messages = {
  ...esES,
  'wallet.connect': 'Conectar billetera',
  'banner.local': 'SANDBOX LOCAL · fork de mainnet en esta computadora ·',
  'wallet.add': '+ Agregar {sym} a la billetera',
  'wallet.added': '✓ Agregado',
  'wallet.check': 'Revisa tu billetera…',
  'stake.confirm': 'Confirma en tu billetera…',
  'stake.enterAmount': 'Ingresa un monto',
  'stake.amount': 'Monto',
  'stake.how3.d': 'Al desbloquear, retira todo lo que pusiste en staking más cualquier recompensa sin reclamar.',
  'issue.balance': 'Tu saldo de {sym} no alcanza',
  'issue.budget': 'El pool no tiene suficiente presupuesto de recompensas para este stake',
  'dash.connect': 'Conecta tu billetera para ver tus posiciones.',
  'dash.confirm': 'Confirma en la billetera…',
  'stake.thAtAmount': 'Por año con ese monto',
  'home.farmers.text':
    'Elige un pool, un monto y un bloqueo de 12 a 60 meses. Tu recompensa exacta se reserva en cuanto haces farming, y recuperas todo tu stake al desbloquear.',
  'home.kicker': 'Morpheus DAT · airdrops genuinos',
  'home.title': 'Haz farming con tu stETH, stablecoins y MOR para ganar OG Tokens.',
  'home.sub': 'Los OG Tokens llegan a los Farmers mediante un airdrop genuino: se ganan con compromiso, no caen en wallets al azar. Haz stake, bloquea por más tiempo y obtén un multiplicador mayor. Cualquier builder puede lanzar un pool y empezar a construir una tesorería de activos digitales MOR.',
};
