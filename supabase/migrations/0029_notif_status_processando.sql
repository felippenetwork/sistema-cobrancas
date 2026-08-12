-- Adiciona valor 'processando' ao enum notif_status para suportar
-- claim atômico que previne envio duplo de notificações WhatsApp.
ALTER TYPE notif_status ADD VALUE IF NOT EXISTS 'processando';
