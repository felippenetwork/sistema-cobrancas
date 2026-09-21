-- Remoção da Meta Cloud API do produto (decisão do dono do projeto, 2026-09-21).
-- WhatsApp agora tem um único canal: uazapi (QR Code). Toda a integração Meta
-- (cron próprio, webhook, templates aprovados, credenciais) foi removida do
-- código nesta mesma tarefa — esta migration remove as colunas que só
-- existiam para guardar credenciais/config da Meta, agora sem uso algum.

alter table public.configuracoes
  drop column if exists meta_access_token,
  drop column if exists meta_phone_number_id,
  drop column if exists meta_waba_id,
  drop column if exists meta_api_ativo,
  drop column if exists meta_app_secret;

alter table public.notificacoes_config
  drop column if exists meta_template_nome,
  drop column if exists meta_template_idioma,
  drop column if exists meta_template_corpo;

-- Só o ID de aprovação da Meta — categoria/idioma/cabeçalho/rodapé/botões
-- continuam existindo na tabela (usados como texto livre pelos modelos de
-- disparo via uazapi, sem processo de aprovação).
alter table public.modelos_wa
  drop column if exists meta_template_id;
