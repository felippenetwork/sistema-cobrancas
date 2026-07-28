export const metadata = {
  title: 'Política de Privacidade — Cobranx',
}

export default function PoliticaPrivacidade() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px', fontFamily: 'sans-serif', lineHeight: 1.7, color: '#222' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Política de Privacidade</h1>
      <p style={{ color: '#666', marginBottom: 40 }}>Última atualização: julho de 2026</p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>1. Quem somos</h2>
        <p>
          O <strong>Cobranx</strong> é uma plataforma de gestão de cobranças e comunicação com clientes,
          operada por meio do domínio <strong>cobranx.site</strong>. Este documento descreve como
          coletamos, usamos e protegemos as informações dos nossos usuários.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>2. Dados coletados</h2>
        <p>Coletamos os seguintes tipos de dados:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Dados de cadastro: nome, e-mail e informações da empresa</li>
          <li>Dados de clientes inseridos na plataforma: nome, telefone, CPF/CNPJ e valores de cobranças</li>
          <li>Dados de uso: logs de acesso, ações realizadas na plataforma</li>
          <li>Mensagens enviadas via WhatsApp Business API (Meta) para fins de cobrança</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>3. Finalidade do uso</h2>
        <p>Os dados são utilizados exclusivamente para:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Prestação dos serviços contratados de gestão de cobranças</li>
          <li>Envio de notificações de cobrança via WhatsApp, e-mail ou SMS</li>
          <li>Suporte técnico e atendimento ao usuário</li>
          <li>Melhoria contínua da plataforma</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>4. Compartilhamento de dados</h2>
        <p>
          Não vendemos nem compartilhamos dados pessoais com terceiros, exceto com prestadores de
          serviços essenciais ao funcionamento da plataforma (como provedores de infraestrutura,
          serviços de envio de mensagens e processadores de pagamento), sempre sob obrigação contratual
          de confidencialidade.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>5. WhatsApp Business API</h2>
        <p>
          Utilizamos a API oficial do WhatsApp Business (Meta) para envio de mensagens de cobrança.
          As mensagens são enviadas apenas para números que forneceram consentimento ou com quem há
          relação comercial prévia. Os dados são processados em conformidade com os{' '}
          <a href="https://www.whatsapp.com/legal/business-policy" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
            Termos de Serviço do WhatsApp Business
          </a>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>6. Segurança</h2>
        <p>
          Adotamos medidas técnicas e organizacionais para proteger os dados contra acesso não
          autorizado, alteração, divulgação ou destruição, incluindo criptografia em trânsito (TLS)
          e controle de acesso por autenticação.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>7. Direitos do titular</h2>
        <p>
          Em conformidade com a LGPD (Lei nº 13.709/2018), você pode solicitar acesso, correção ou
          exclusão dos seus dados a qualquer momento pelo e-mail:{' '}
          <a href="mailto:contato@cobranx.site" style={{ color: '#2563eb' }}>contato@cobranx.site</a>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>8. Retenção de dados</h2>
        <p>
          Os dados são mantidos enquanto a conta estiver ativa. Após o encerramento, os dados são
          retidos por até 90 dias para fins de auditoria e, em seguida, excluídos permanentemente.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>9. Alterações nesta política</h2>
        <p>
          Reservamo-nos o direito de atualizar esta política. Alterações relevantes serão comunicadas
          por e-mail ou aviso na plataforma.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>10. Contato</h2>
        <p>
          Dúvidas sobre esta política:{' '}
          <a href="mailto:contato@cobranx.site" style={{ color: '#2563eb' }}>contato@cobranx.site</a>
        </p>
      </section>
    </main>
  )
}
