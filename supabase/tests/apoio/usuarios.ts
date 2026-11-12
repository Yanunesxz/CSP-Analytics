/**
 * O que os testes de usuários esperam: os ids de tests/fixtures/usuarios.sql (dados inventados) e o quadro de
 * permissões de docs/dados/listas.md ("Permissões"), escrito à parte do banco de propósito: o teste compara os dois.
 */

/** Primeiro dono (convite sem quem convidou). */
export const DONO = '00000000-0000-4000-8000-0000000000d1';
/** Dono convidado pelo primeiro. */
export const SEGUNDO_DONO = '00000000-0000-4000-8000-0000000000d2';
/** Gestor de tráfego convidado pelo dono. */
export const GESTOR = '00000000-0000-4000-8000-0000000000e1';
/** Gestor que perdeu o acesso (perfil inativo). */
export const EX_GESTOR = '00000000-0000-4000-8000-0000000000e2';
/** Login sem convite: não tem perfil. */
export const SEM_PERFIL = '00000000-0000-4000-8000-0000000000f1';

export type Papel = 'owner' | 'traffic_manager' | 'summary_viewer';

/**
 * O que cada papel pode, na ordem da lista mkt.app_action (a de api.my_permissions). Ninguém tem
 * `view_lead_personal_data`: a ficha fica no CSP 360.
 */
export const PODE: Readonly<Record<Papel, readonly string[]>> = {
  owner: [
    'view_numbers',
    'view_leads',
    'view_traffic',
    'operate_traffic',
    'approve_action',
    'stop_all',
    'configure_traffic',
    'view_connectors',
    'retry_connector',
    'manage_users',
    'view_diagnostics',
    'edit_settings',
    'view_summary',
  ],
  traffic_manager: [
    'view_numbers',
    'view_leads',
    'view_traffic',
    'operate_traffic',
    'view_connectors',
    'edit_settings',
    'view_summary',
  ],
  // Decisão 0043: só o Resumo simples e as próprias configurações.
  summary_viewer: ['edit_settings', 'view_summary'],
};

/** As ações que pedem o segundo fator (decisão 0023). Parar tudo nunca pede. */
export const SEGUNDO_FATOR: readonly string[] = [
  'approve_action',
  'configure_traffic',
  'manage_users',
  'retry_connector',
];
