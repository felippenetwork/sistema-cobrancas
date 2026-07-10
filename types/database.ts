// Generated from supabase/migrations/* — update after schema changes via:
//   npx supabase gen types typescript --project-id jbtqrxnpxisnboiqwyrb > types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// ── Enum types ──────────────────────────────────────────────────────────────
type AssinaturaStatus  = 'ativa' | 'pendente' | 'cancelada' | 'inadimplente'
type CobrancaStatus    = 'ativa' | 'concluida' | 'cancelada'
type ConexaoStatus     = 'conectado' | 'desconectado' | 'conectando'
type ContaStatus       = 'ativa' | 'suspensa' | 'expirada'
type EmailModo         = 'compartilhado' | 'proprio'
type LancamentoOrigem  = 'parcela' | 'manual'
type LancamentoTipo    = 'entrada' | 'saida'
type MeioPagTipo       = 'pix' | 'outro'
type NotifCanal        = 'whatsapp' | 'email'
type NotifStatus       = 'fila' | 'enviado' | 'entregue' | 'lido' | 'aberto' | 'falhou' | 'cancelado'
type NotifTipo         = '5d' | '3d' | '2d' | '1d' | 'dia' | 'vencido1d' | 'manual' | 'boasvindas' | 'pagamento_confirmado' | 'agendada'
type ParcelaStatus     = 'aberta' | 'paga' | 'vencida'

export type Database = {
  public: {
    Tables: {
      assinaturas: {
        Row: {
          conta_id: string
          created_at: string
          id: string
          mp_preapproval_id: string | null
          proximo_vencimento: string | null
          status: AssinaturaStatus
          ultimo_evento_mp: Json | null
          updated_at: string
          valor: number | null
        }
        Insert: {
          conta_id: string
          created_at?: string
          id?: string
          mp_preapproval_id?: string | null
          proximo_vencimento?: string | null
          status?: AssinaturaStatus
          ultimo_evento_mp?: Json | null
          updated_at?: string
          valor?: number | null
        }
        Update: {
          conta_id?: string
          created_at?: string
          id?: string
          mp_preapproval_id?: string | null
          proximo_vencimento?: string | null
          status?: AssinaturaStatus
          ultimo_evento_mp?: Json | null
          updated_at?: string
          valor?: number | null
        }
        Relationships: [{ foreignKeyName: 'assinaturas_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] }]
      }
      audit_log: {
        Row: {
          acao: string
          actor: string
          actor_id: string | null
          conta_id_alvo: string | null
          created_at: string
          detalhe: Json | null
          id: string
        }
        Insert: {
          acao: string
          actor: string
          actor_id?: string | null
          conta_id_alvo?: string | null
          created_at?: string
          detalhe?: Json | null
          id?: string
        }
        Update: {
          acao?: string
          actor?: string
          actor_id?: string | null
          conta_id_alvo?: string | null
          created_at?: string
          detalhe?: Json | null
          id?: string
        }
        Relationships: [{ foreignKeyName: 'audit_log_conta_id_alvo_fkey'; columns: ['conta_id_alvo']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] }]
      }
      baixas_externas: {
        Row: {
          id: string
          conta_id: string
          cliente_id: string
          parcela_id: string
          login_externo: string
          tipo_integracao: string
          status: string
          tentativas: number
          erro: string | null
          criado_em: string
          processado_em: string | null
        }
        Insert: {
          id?: string
          conta_id: string
          cliente_id: string
          parcela_id: string
          login_externo: string
          tipo_integracao: string
          status?: string
          tentativas?: number
          erro?: string | null
          criado_em?: string
          processado_em?: string | null
        }
        Update: {
          id?: string
          conta_id?: string
          cliente_id?: string
          parcela_id?: string
          login_externo?: string
          tipo_integracao?: string
          status?: string
          tentativas?: number
          erro?: string | null
          criado_em?: string
          processado_em?: string | null
        }
        Relationships: [
          { foreignKeyName: 'baixas_externas_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] },
          { foreignKeyName: 'baixas_externas_cliente_id_fkey'; columns: ['cliente_id']; isOneToOne: false; referencedRelation: 'clientes'; referencedColumns: ['id'] },
          { foreignKeyName: 'baixas_externas_parcela_id_fkey'; columns: ['parcela_id']; isOneToOne: false; referencedRelation: 'parcelas'; referencedColumns: ['id'] },
        ]
      }
      clientes: {
        Row: {
          celular: string
          conta_id: string
          cpf: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          login_externo: string | null
          nome: string
          optout_email: boolean
          sobrenome: string | null
          tipo_integracao: string | null
          updated_at: string
        }
        Insert: {
          celular: string
          conta_id: string
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          login_externo?: string | null
          nome: string
          optout_email?: boolean
          sobrenome?: string | null
          tipo_integracao?: string | null
          updated_at?: string
        }
        Update: {
          celular?: string
          conta_id?: string
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          login_externo?: string | null
          nome?: string
          optout_email?: boolean
          sobrenome?: string | null
          tipo_integracao?: string | null
          updated_at?: string
        }
        Relationships: [{ foreignKeyName: 'clientes_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] }]
      }
      cobrancas: {
        Row: {
          cliente_id: string
          conta_id: string
          created_at: string
          dia_pagamento: number
          enviar_boas_vindas: boolean
          id: string
          meio_pagamento_id: string | null
          mes_ano_inicio: string
          observacao: string | null
          qtd_parcelas: number | null
          recorrente: boolean
          status: CobrancaStatus
          updated_at: string
          valor_mensalidade: number
        }
        Insert: {
          cliente_id: string
          conta_id: string
          created_at?: string
          dia_pagamento: number
          enviar_boas_vindas?: boolean
          id?: string
          meio_pagamento_id?: string | null
          mes_ano_inicio: string
          observacao?: string | null
          qtd_parcelas?: number | null
          recorrente?: boolean
          status?: CobrancaStatus
          updated_at?: string
          valor_mensalidade: number
        }
        Update: {
          cliente_id?: string
          conta_id?: string
          created_at?: string
          dia_pagamento?: number
          enviar_boas_vindas?: boolean
          id?: string
          meio_pagamento_id?: string | null
          mes_ano_inicio?: string
          observacao?: string | null
          qtd_parcelas?: number | null
          recorrente?: boolean
          status?: CobrancaStatus
          updated_at?: string
          valor_mensalidade?: number
        }
        Relationships: [
          { foreignKeyName: 'cobrancas_cliente_id_fkey'; columns: ['cliente_id']; isOneToOne: false; referencedRelation: 'clientes'; referencedColumns: ['id'] },
          { foreignKeyName: 'cobrancas_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] },
          { foreignKeyName: 'cobrancas_meio_pagamento_id_fkey'; columns: ['meio_pagamento_id']; isOneToOne: false; referencedRelation: 'meios_pagamento'; referencedColumns: ['id'] },
        ]
      }
      configuracoes: {
        Row: {
          contato: string | null
          conta_id: string
          cpf_cnpj: string | null
          endereco: string | null
          horario_fim: string
          horario_inicio: string
          intervalo_max_seg: number
          intervalo_min_seg: number
          nome_comercial: string | null
          updated_at: string
        }
        Insert: {
          contato?: string | null
          conta_id: string
          cpf_cnpj?: string | null
          endereco?: string | null
          horario_fim?: string
          horario_inicio?: string
          intervalo_max_seg?: number
          intervalo_min_seg?: number
          nome_comercial?: string | null
          updated_at?: string
        }
        Update: {
          contato?: string | null
          conta_id?: string
          cpf_cnpj?: string | null
          endereco?: string | null
          horario_fim?: string
          horario_inicio?: string
          intervalo_max_seg?: number
          intervalo_min_seg?: number
          nome_comercial?: string | null
          updated_at?: string
        }
        Relationships: [{ foreignKeyName: 'configuracoes_conta_id_fkey'; columns: ['conta_id']; isOneToOne: true; referencedRelation: 'contas'; referencedColumns: ['id'] }]
      }
      conexoes: {
        Row: {
          comando: string | null
          conta_id: string
          created_at: string
          desconectado_em: string | null
          device_name: string | null
          id: string
          numero_conectado: string | null
          qr_code: string | null
          session_ref: string | null
          status: ConexaoStatus
          ultima_conexao: string | null
          updated_at: string
          uazapi_instance_token: string | null
        }
        Insert: {
          comando?: string | null
          conta_id: string
          created_at?: string
          desconectado_em?: string | null
          device_name?: string | null
          id?: string
          numero_conectado?: string | null
          qr_code?: string | null
          session_ref?: string | null
          status?: ConexaoStatus
          ultima_conexao?: string | null
          updated_at?: string
          uazapi_instance_token?: string | null
        }
        Update: {
          comando?: string | null
          conta_id?: string
          created_at?: string
          desconectado_em?: string | null
          device_name?: string | null
          id?: string
          numero_conectado?: string | null
          qr_code?: string | null
          session_ref?: string | null
          status?: ConexaoStatus
          ultima_conexao?: string | null
          updated_at?: string
          uazapi_instance_token?: string | null
        }
        Relationships: [{ foreignKeyName: 'conexoes_conta_id_fkey'; columns: ['conta_id']; isOneToOne: true; referencedRelation: 'contas'; referencedColumns: ['id'] }]
      }
      contas: {
        Row: {
          created_at: string
          id: string
          limite_clientes: number
          nome_empresa: string
          owner_user_id: string
          status: ContaStatus
          updated_at: string
          validade_plano: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          limite_clientes?: number
          nome_empresa: string
          owner_user_id: string
          status?: ContaStatus
          updated_at?: string
          validade_plano?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          limite_clientes?: number
          nome_empresa?: string
          owner_user_id?: string
          status?: ContaStatus
          updated_at?: string
          validade_plano?: string | null
        }
        Relationships: []
      }
      email_remetente: {
        Row: {
          conta_id: string
          created_at: string
          dominio_proprio: string | null
          from_name: string | null
          id: string
          local_part: string
          modo: EmailModo
          registros_dns: Json | null
          resend_domain_id: string | null
          status_dominio: string | null
          updated_at: string
        }
        Insert: {
          conta_id: string
          created_at?: string
          dominio_proprio?: string | null
          from_name?: string | null
          id?: string
          local_part: string
          modo?: EmailModo
          registros_dns?: Json | null
          resend_domain_id?: string | null
          status_dominio?: string | null
          updated_at?: string
        }
        Update: {
          conta_id?: string
          created_at?: string
          dominio_proprio?: string | null
          from_name?: string | null
          id?: string
          local_part?: string
          modo?: EmailModo
          registros_dns?: Json | null
          resend_domain_id?: string | null
          status_dominio?: string | null
          updated_at?: string
        }
        Relationships: [{ foreignKeyName: 'email_remetente_conta_id_fkey'; columns: ['conta_id']; isOneToOne: true; referencedRelation: 'contas'; referencedColumns: ['id'] }]
      }
      lancamentos: {
        Row: {
          conta_id: string
          created_at: string
          data: string
          descricao: string | null
          id: string
          origem: LancamentoOrigem
          parcela_id: string | null
          tipo: LancamentoTipo
          valor: number
        }
        Insert: {
          conta_id: string
          created_at?: string
          data?: string
          descricao?: string | null
          id?: string
          origem: LancamentoOrigem
          parcela_id?: string | null
          tipo: LancamentoTipo
          valor: number
        }
        Update: {
          conta_id?: string
          created_at?: string
          data?: string
          descricao?: string | null
          id?: string
          origem?: LancamentoOrigem
          parcela_id?: string | null
          tipo?: LancamentoTipo
          valor?: number
        }
        Relationships: [
          { foreignKeyName: 'lancamentos_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] },
          { foreignKeyName: 'lancamentos_parcela_id_fkey'; columns: ['parcela_id']; isOneToOne: false; referencedRelation: 'parcelas'; referencedColumns: ['id'] },
        ]
      }
      meios_pagamento: {
        Row: {
          conta_id: string
          created_at: string
          id: string
          is_padrao: boolean
          mensagem: string
          nome: string
          tipo: MeioPagTipo
          updated_at: string
        }
        Insert: {
          conta_id: string
          created_at?: string
          id?: string
          is_padrao?: boolean
          mensagem: string
          nome: string
          tipo?: MeioPagTipo
          updated_at?: string
        }
        Update: {
          conta_id?: string
          created_at?: string
          id?: string
          is_padrao?: boolean
          mensagem?: string
          nome?: string
          tipo?: MeioPagTipo
          updated_at?: string
        }
        Relationships: [{ foreignKeyName: 'meios_pagamento_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] }]
      }
      mensagens_wa: {
        Row: {
          id: string
          conta_id: string
          cliente_id: string | null
          celular: string
          direcao: 'in' | 'out'
          texto: string
          tipo: string
          status: string
          wa_id: string | null
          recebido_em: string
          lida: boolean
        }
        Insert: {
          id?: string
          conta_id: string
          cliente_id?: string | null
          celular: string
          direcao: 'in' | 'out'
          texto: string
          tipo?: string
          status?: string
          wa_id?: string | null
          recebido_em?: string
          lida?: boolean
        }
        Update: {
          id?: string
          conta_id?: string
          cliente_id?: string | null
          celular?: string
          direcao?: 'in' | 'out'
          texto?: string
          tipo?: string
          status?: string
          wa_id?: string | null
          recebido_em?: string
          lida?: boolean
        }
        Relationships: [
          { foreignKeyName: 'mensagens_wa_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] },
          { foreignKeyName: 'mensagens_wa_cliente_id_fkey'; columns: ['cliente_id']; isOneToOne: false; referencedRelation: 'clientes'; referencedColumns: ['id'] },
        ]
      }
      notificacoes_config: {
        Row: {
          assunto_email: string | null
          ativo_email: boolean
          ativo_whatsapp: boolean
          conta_id: string
          created_at: string
          horario: string
          id: string
          template_email: string | null
          template_whatsapp: string | null
          tipo: NotifTipo
          updated_at: string
        }
        Insert: {
          assunto_email?: string | null
          ativo_email?: boolean
          ativo_whatsapp?: boolean
          conta_id: string
          created_at?: string
          horario?: string
          id?: string
          template_email?: string | null
          template_whatsapp?: string | null
          tipo: NotifTipo
          updated_at?: string
        }
        Update: {
          assunto_email?: string | null
          ativo_email?: boolean
          ativo_whatsapp?: boolean
          conta_id?: string
          created_at?: string
          horario?: string
          id?: string
          template_email?: string | null
          template_whatsapp?: string | null
          tipo?: NotifTipo
          updated_at?: string
        }
        Relationships: [{ foreignKeyName: 'notificacoes_config_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] }]
      }
      notificacoes_enviadas: {
        Row: {
          agendado_para: string | null
          assunto: string | null
          canal: NotifCanal
          cliente_id: string
          cobranca_id: string | null
          conta_id: string
          created_at: string
          enviado_em: string | null
          id: string
          mensagem_final: string | null
          parcela_id: string | null
          resend_message_id: string | null
          status: NotifStatus
          tipo: NotifTipo
        }
        Insert: {
          agendado_para?: string | null
          assunto?: string | null
          canal: NotifCanal
          cliente_id: string
          cobranca_id?: string | null
          conta_id: string
          created_at?: string
          enviado_em?: string | null
          id?: string
          mensagem_final?: string | null
          parcela_id?: string | null
          resend_message_id?: string | null
          status?: NotifStatus
          tipo: NotifTipo
        }
        Update: {
          agendado_para?: string | null
          assunto?: string | null
          canal?: NotifCanal
          cliente_id?: string
          cobranca_id?: string | null
          conta_id?: string
          created_at?: string
          enviado_em?: string | null
          id?: string
          mensagem_final?: string | null
          parcela_id?: string | null
          resend_message_id?: string | null
          status?: NotifStatus
          tipo?: NotifTipo
        }
        Relationships: [
          { foreignKeyName: 'notificacoes_enviadas_cliente_id_fkey'; columns: ['cliente_id']; isOneToOne: false; referencedRelation: 'clientes'; referencedColumns: ['id'] },
          { foreignKeyName: 'notificacoes_enviadas_cobranca_id_fkey'; columns: ['cobranca_id']; isOneToOne: false; referencedRelation: 'cobrancas'; referencedColumns: ['id'] },
          { foreignKeyName: 'notificacoes_enviadas_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] },
          { foreignKeyName: 'notificacoes_enviadas_parcela_id_fkey'; columns: ['parcela_id']; isOneToOne: false; referencedRelation: 'parcelas'; referencedColumns: ['id'] },
        ]
      }
      parcelas: {
        Row: {
          cobranca_id: string
          conta_id: string
          created_at: string
          data_pagamento: string | null
          data_vencimento: string
          id: string
          numero: number
          observacao: string | null
          status: ParcelaStatus
          updated_at: string
          valor: number
        }
        Insert: {
          cobranca_id: string
          conta_id: string
          created_at?: string
          data_pagamento?: string | null
          data_vencimento: string
          id?: string
          numero: number
          observacao?: string | null
          status?: ParcelaStatus
          updated_at?: string
          valor: number
        }
        Update: {
          cobranca_id?: string
          conta_id?: string
          created_at?: string
          data_pagamento?: string | null
          data_vencimento?: string
          id?: string
          numero?: number
          observacao?: string | null
          status?: ParcelaStatus
          updated_at?: string
          valor?: number
        }
        Relationships: [
          { foreignKeyName: 'parcelas_cobranca_id_fkey'; columns: ['cobranca_id']; isOneToOne: false; referencedRelation: 'cobrancas'; referencedColumns: ['id'] },
          { foreignKeyName: 'parcelas_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] },
        ]
      }
      plataforma_admins: {
        Row: { created_at: string; user_id: string }
        Insert: { created_at?: string; user_id: string }
        Update: { created_at?: string; user_id?: string }
        Relationships: []
      }
      plataforma_config: {
        Row: { dominio_email_operador: string | null; id: number; updated_at: string }
        Insert: { dominio_email_operador?: string | null; id?: number; updated_at?: string }
        Update: { dominio_email_operador?: string | null; id?: number; updated_at?: string }
        Relationships: []
      }
      saudacoes: {
        Row: { conta_id: string; created_at: string; id: string; texto: string }
        Insert: { conta_id: string; created_at?: string; id?: string; texto: string }
        Update: { conta_id?: string; created_at?: string; id?: string; texto?: string }
        Relationships: [{ foreignKeyName: 'saudacoes_conta_id_fkey'; columns: ['conta_id']; isOneToOne: false; referencedRelation: 'contas'; referencedColumns: ['id'] }]
      }
    }
    Views: Record<never, never>
    Functions: {
      baixar_parcela: {
        Args: { p_parcela_id: string; p_conta_id: string; p_hoje: string }
        Returns: Json
      }
      conta_do_usuario: { Args: Record<never, never>; Returns: string | null }
      is_admin: { Args: Record<never, never>; Returns: boolean }
      set_updated_at: { Args: Record<never, never>; Returns: unknown }
    }
    Enums: {
      assinatura_status: AssinaturaStatus
      cobranca_status: CobrancaStatus
      conexao_status: ConexaoStatus
      conta_status: ContaStatus
      email_modo: EmailModo
      lancamento_origem: LancamentoOrigem
      lancamento_tipo: LancamentoTipo
      meio_pagamento_tipo: MeioPagTipo
      notif_canal: NotifCanal
      notif_status: NotifStatus
      notif_tipo: NotifTipo
      parcela_status: ParcelaStatus
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
