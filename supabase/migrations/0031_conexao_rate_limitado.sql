-- Sinaliza quando a uazapi está limitando (HTTP 429) as checagens de status
-- desta conta. Transitório: o worker limpa assim que uma checagem volta a
-- funcionar. NUNCA usado para decidir apagar/recriar a instância — só para
-- a tela não anunciar "desconectado" por causa de rate limit, e sim
-- "checagem temporariamente limitada".

alter table public.conexoes
  add column if not exists rate_limitado boolean not null default false;

comment on column public.conexoes.rate_limitado is
  'True enquanto a uazapi está devolvendo 429 nas checagens desta conta. Não reflete o estado real da sessão — worker limpa no próximo ciclo bem-sucedido.';
