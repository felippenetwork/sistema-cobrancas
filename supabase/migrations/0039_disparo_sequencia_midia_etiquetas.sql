-- Disparo progressivo, 2ª rodada (pedido do Felippe, 2026-10-23):
--   1. Sequência de mensagens ("caixinhas"): texto e mídia, cada uma com o próprio tempo de
--      "digitando…" antes — campanhas_wa.passos (jsonb, validado em lib/disparo/passos.ts).
--   2. Etiqueta do WhatsApp Business para adicionar/remover da conversa depois do envio.
--   3. Bucket privado para as mídias (o cron gera URL assinada só na hora de enviar).
-- Retrocompatível: campanha sem `passos` continua usando `mensagem`/`variacoes`/modelo.

alter table public.campanhas_wa
  add column if not exists passos jsonb,
  add column if not exists etiqueta_adicionar      text check (etiqueta_adicionar is null or length(etiqueta_adicionar) <= 100),
  add column if not exists etiqueta_adicionar_nome text check (etiqueta_adicionar_nome is null or length(etiqueta_adicionar_nome) <= 100),
  add column if not exists etiqueta_remover        text check (etiqueta_remover is null or length(etiqueta_remover) <= 100),
  add column if not exists etiqueta_remover_nome   text check (etiqueta_remover_nome is null or length(etiqueta_remover_nome) <= 100);

alter table public.campanhas_wa add constraint campanhas_wa_passos_check
  check (passos is null or (jsonb_typeof(passos) = 'array' and jsonb_array_length(passos) between 1 and 10));

-- Progressivo agora pode ter só `passos` (sem `mensagem`).
alter table public.campanhas_wa drop constraint if exists campanhas_wa_progressivo_check;
alter table public.campanhas_wa add constraint campanhas_wa_progressivo_check check (
  tipo <> 'progressivo' or (
    (mensagem is not null or passos is not null)
    and janela_inicio is not null and janela_fim is not null
    and janela_fim > janela_inicio
    and prog_inicio is not null and prog_maximo is not null and prog_maximo >= prog_inicio
  )
);

-- O que não impediu o envio mas não saiu como pedido (etiqueta, parte da sequência).
alter table public.campanha_destinatarios
  add column if not exists aviso text check (aviso is null or length(aviso) <= 500);

-- ── Bucket das mídias do disparo ─────────────────────────────────────────────
-- Privado e SEM policy para o navegador: o upload usa URL assinada gerada pelo servidor
-- (depois de getConta()), sempre dentro de contas/{conta_id}/; a leitura é só do cron
-- (service role), por URL assinada de curta duração entregue à uazapi.
insert into storage.buckets (id, name, public)
values ('disparo-midia', 'disparo-midia', false)
on conflict (id) do nothing;

-- Limites no próprio bucket (o servidor também valida): 16 MB e só os tipos aceitos.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets
       set file_size_limit = 16777216,
           allowed_mime_types = array[
             'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/3gpp',
             'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm', 'application/pdf'
           ]
     where id = 'disparo-midia';
  end if;
end $$;
