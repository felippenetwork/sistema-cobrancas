-- Permite que cada tipo de notificação use um template Meta específico.
-- Se NULL, o worker usa o mapeamento padrão hardcoded.
alter table notificacoes_config
  add column if not exists meta_template_nome   text,
  add column if not exists meta_template_idioma text,
  add column if not exists meta_template_corpo  text;
