// Metadados dos 8 tipos fixos de notificação (PRD §6.5).
// Os DIAS são fixos e não editáveis. Editável: conteúdo por canal, horário,
// ativo/desativo por canal independentemente.

export const NOTIF_TIPOS = [
  { tipo: '5d',        label: '5 dias antes',      desc: 'Enviado 5 dias antes do vencimento' },
  { tipo: '3d',        label: '3 dias antes',      desc: 'Enviado 3 dias antes do vencimento' },
  { tipo: '2d',        label: '2 dias antes',      desc: 'Enviado 2 dias antes do vencimento' },
  { tipo: '1d',        label: '1 dia antes',       desc: 'Enviado 1 dia antes do vencimento' },
  { tipo: 'dia',       label: 'No dia',            desc: 'Enviado no dia do vencimento' },
  { tipo: 'vencido1d', label: '1 dia após',        desc: 'Enviado se a parcela não foi paga' },
  { tipo: 'manual',    label: 'Cobrança manual',   desc: 'Disparado pelo botão WhatsApp na parcela' },
  { tipo: 'boasvindas', label: 'Boas-vindas',      desc: 'Enviado ao cadastrar nova cobrança (opcional)' },
] as const

export type NotifTipo = (typeof NOTIF_TIPOS)[number]['tipo']

// Saudações padrão (PRD §8.4)
export const SAUDACOES_PADRAO = [
  'Olá, tudo bem?',
  'Oi, tudo bem com você?',
  'Olá! Espero que esteja tudo bem por aí.',
  'Oi, tudo certo por aí?',
  'Olá, como vai você?',
  'Oi! Tudo tranquilo?',
  'Olá, tudo bem por aí?',
  'Oi, espero que esteja tudo ótimo!',
  'Olá! Tudo bem contigo?',
  'Oi, como você está?',
]

// Templates padrão por tipo. Usados no seed de novas contas.
// O operador pode editar o conteúdo; os dias são fixos.
export const NOTIF_DEFAULTS: {
  tipo:               string
  horario:            string
  template_whatsapp:  string
  assunto_email:      string
  template_email:     string
}[] = [
  {
    tipo:              '5d',
    horario:           '10:00',
    template_whatsapp: '#SAUDACAO# #NOME#! 📋 Sua mensalidade de *#VALOR#* vence em 5 dias (dia #VENCIMENTO#).\n\n💳 Para pagar via Pix:\n#PIX#',
    assunto_email:     'Lembrete: sua mensalidade vence em 5 dias',
    template_email:    '#SAUDACAO# #NOME#!\n\nSua mensalidade de #VALOR# vence em 5 dias, no dia #VENCIMENTO#.\n\nPara pagar via Pix:\n#PIX#\n\nAtt.',
  },
  {
    tipo:              '3d',
    horario:           '10:00',
    template_whatsapp: '#SAUDACAO# #NOME#! Sua mensalidade de *#VALOR#* vence em 3 dias (dia #VENCIMENTO#).\n\n💳 Pix: #PIX#',
    assunto_email:     'Lembrete: sua mensalidade vence em 3 dias',
    template_email:    '#SAUDACAO# #NOME#!\n\nSua mensalidade de #VALOR# vence em 3 dias, no dia #VENCIMENTO#.\n\nPix: #PIX#\n\nAtt.',
  },
  {
    tipo:              '2d',
    horario:           '10:00',
    template_whatsapp: '#SAUDACAO# #NOME#! Sua mensalidade de *#VALOR#* vence em 2 dias (dia #VENCIMENTO#).\n\n💳 Pix: #PIX#',
    assunto_email:     'Lembrete: sua mensalidade vence em 2 dias',
    template_email:    '#SAUDACAO# #NOME#!\n\nSua mensalidade de #VALOR# vence em 2 dias, no dia #VENCIMENTO#.\n\nPix: #PIX#',
  },
  {
    tipo:              '1d',
    horario:           '10:00',
    template_whatsapp: '#SAUDACAO# #NOME#! ⚠️ Sua mensalidade de *#VALOR#* vence *AMANHÃ* (dia #VENCIMENTO#).\n\n💳 Pix: #PIX#',
    assunto_email:     'Sua mensalidade vence amanhã',
    template_email:    '#SAUDACAO# #NOME#!\n\nSua mensalidade de #VALOR# vence amanhã, dia #VENCIMENTO#.\n\nPix: #PIX#',
  },
  {
    tipo:              'dia',
    horario:           '09:00',
    template_whatsapp: '#SAUDACAO# #NOME#! 🔔 Sua mensalidade de *#VALOR#* vence *HOJE* (dia #VENCIMENTO#).\n\n💳 Pix: #PIX#',
    assunto_email:     'Sua mensalidade vence HOJE',
    template_email:    '#SAUDACAO# #NOME#!\n\nSua mensalidade de #VALOR# vence hoje, dia #VENCIMENTO#.\n\nPix: #PIX#',
  },
  {
    tipo:              'vencido1d',
    horario:           '10:00',
    template_whatsapp: '#SAUDACAO# #NOME#! ⚠️ Sua mensalidade de *#VALOR#* venceu no dia #VENCIMENTO# e ainda não foi paga.\n\n💳 Pix: #PIX#\n\nSe já pagou, desconsidere.',
    assunto_email:     'Mensalidade em atraso',
    template_email:    '#SAUDACAO# #NOME#!\n\nSua mensalidade de #VALOR# venceu no dia #VENCIMENTO# e ainda está em aberto.\n\nPix: #PIX#\n\nSe já pagou, desconsidere.',
  },
  {
    tipo:              'manual',
    horario:           '10:00',
    template_whatsapp: '#SAUDACAO# #NOME#! 📋 Passando para lembrar da mensalidade de *#VALOR#* com vencimento em #VENCIMENTO#.\n\n💳 Pix: #PIX#',
    assunto_email:     'Cobrança — Mensalidade',
    template_email:    '#SAUDACAO# #NOME#!\n\nSua mensalidade de #VALOR# com vencimento em #VENCIMENTO# ainda está em aberto.\n\nPix: #PIX#',
  },
  {
    tipo:              'boasvindas',
    horario:           '10:00',
    template_whatsapp: '#SAUDACAO# #NOME#! Seu cadastro foi realizado! 🎉\n\nVocê receberá lembretes sobre sua mensalidade de *#VALOR#*.\n\n💳 Para pagar via Pix: #PIX#',
    assunto_email:     'Bem-vindo! Cadastro realizado',
    template_email:    '#SAUDACAO# #NOME#!\n\nSeu cadastro foi realizado com sucesso!\n\nVocê receberá lembretes sobre sua mensalidade de #VALOR#.\n\nPix: #PIX#\n\nBem-vindo!',
  },
]
