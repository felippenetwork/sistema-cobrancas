-- Torna sobrenome, cpf e email opcionais na tabela clientes.
-- Apenas nome e celular são obrigatórios.

alter table public.clientes alter column sobrenome drop not null;
alter table public.clientes alter column cpf       drop not null;
alter table public.clientes alter column email     drop not null;
