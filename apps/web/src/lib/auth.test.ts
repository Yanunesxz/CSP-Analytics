import { describe, expect, it } from 'vitest';
import { mensagemDoLogin, perfilDaLinha } from './auth';

describe('perfilDaLinha', () => {
  it('o perfil ativo vira o perfil da tela, com o papel do banco', () => {
    expect(
      perfilDaLinha({
        id: 'u1',
        email: 'dono@example.com',
        display_name: 'Dono',
        role: 'owner',
        is_active: true,
      }),
    ).toEqual({ id: 'u1', name: 'Dono', email: 'dono@example.com', role: 'owner' });
  });

  it('sem linha ou com o perfil inativo, ninguém entra', () => {
    expect(perfilDaLinha(undefined)).toBeNull();
    expect(
      perfilDaLinha({ id: 'u2', email: null, display_name: 'Ex', role: 'traffic_manager', is_active: false }),
    ).toBeNull();
  });
});

describe('mensagemDoLogin', () => {
  it('não diz se o e-mail existe', () => {
    expect(mensagemDoLogin({ status: 400, code: 'invalid_credentials' })).toBe(
      'E-mail ou senha não conferem. Confira e tente de novo.',
    );
  });

  it('muitas tentativas e falha de rede têm mensagens próprias', () => {
    expect(mensagemDoLogin({ status: 429 })).toBe('Muitas tentativas. Espere um minuto e tente de novo.');
    expect(mensagemDoLogin({ status: 0, message: 'Failed to fetch' })).toBe(
      'Não deu para entrar agora. Confira a internet e tente de novo.',
    );
    expect(mensagemDoLogin(null)).toBeNull();
  });
});
