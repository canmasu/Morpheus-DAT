import type { Messages } from './en';
import { ptBR } from './pt-br';

/** European Portuguese: Brazil's text with European wording ("ecrã", "carteira", "consulte", "efetuar"). */
export const ptPT: Messages = {
  ...ptBR,
  'wallet.connecting': 'A ligar…',
  'wallet.connect': 'Ligar carteira',
  'banner.local': 'SANDBOX LOCAL · fork da mainnet neste computador ·',
  'lang.title': 'Selecione um idioma',
  'lang.default': '(predefinido)',
  'home.title': 'Faça farming com o seu stETH, stablecoins e MOR para ganhar OG Tokens.',
  'home.sub': 'Os OG Tokens chegam aos Farmers por um airdrop genuíno: conquistados com compromisso, não lançados em carteiras aleatórias. Faça stake, bloqueie durante mais tempo e obtenha um multiplicador maior. Qualquer builder pode lançar um pool e começar a construir uma tesouraria de ativos digitais MOR.',
  'home.farmers.text':
    'Escolha um pool, um montante e um bloqueio de 12 a 60 meses. A sua recompensa exata fica reservada assim que faz farming, e recupera todo o seu stake no desbloqueio.',
  'home.safe.title': 'O seu stake continua a ser seu',
  'common.loading': 'A carregar…',
  'wallet.check': 'Verifique a sua carteira…',
  'pools.sub': 'Faça farming com o seu {assets}. Recupera todo o stake no desbloqueio e ganha OG Tokens, fixados no momento do farming.',
  'stake.loadingPool': 'A carregar o pool…',
  'stake.amount': 'Montante',
  'stake.receive': 'Recebe',
  'stake.confirm': 'Confirme na sua carteira…',
  'stake.enterAmount': 'Introduza um montante',
  'stake.thAtAmount': 'Por ano com esse montante',
  'stake.seePositions': 'Ver as suas posições',
  'stake.how1.d': 'A sua recompensa é fixada e reservada na totalidade no momento do stake. Cresce a cada segundo; pode resgatá-la quando quiser.',
  'issue.balance': 'O seu saldo de {sym} é insuficiente',
  'share.button': 'Partilhar',
  'share.title': 'Partilhar este pool',
  'share.x': 'Publicar no X',
  'share.text': 'Faça stake de {amount} {sym} durante {lock} no pool {pool} da Morpheus DAT: recupere os seus {amount} {sym} no desbloqueio + {reward} {rsym}.',
  'dash.title': 'As suas posições',
  'dash.sub': 'As recompensas crescem a cada segundo. Recupera todo o stake no desbloqueio.',
  'dash.connect': 'Ligue a sua carteira para ver as suas posições.',
  'dash.confirm': 'Confirme na carteira…',
  'home.kicker': 'Morpheus DAT · airdrops genuínos',
  'stake.how2.dBase': 'O seu MOR vai para a subnet do Morpheus Builders deste pool, onde rende MOR para o Partner. 30 dias antes do desbloqueio, regressa a este pool.',
};
