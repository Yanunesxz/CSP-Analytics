/** O papel da demonstração pelo `?papel=` do endereço de abertura (só na demonstração; decisão 0043). */

import { describe, expect, it } from 'vitest';
import { PERFIL_DEMONSTRACAO, iniciais, perfilDaDemonstracao } from './auth';

describe('perfilDaDemonstracao', () => {
  it('sem ?papel=, ou com o do dono, é o dono de exemplo', () => {
    expect(perfilDaDemonstracao('')).toBe(PERFIL_DEMONSTRACAO);
    expect(perfilDaDemonstracao('?marca=cs&papel=owner')).toBe(PERFIL_DEMONSTRACAO);
  });

  it('?papel=summary_viewer abre como o leitor do resumo, sem e-mail', () => {
    const p = perfilDaDemonstracao('?marca=todas&papel=summary_viewer');
    expect(p).toEqual({
      id: 'demo-summary_viewer',
      name: 'Leitor do resumo (demonstração)',
      email: '',
      role: 'summary_viewer',
    });
    expect(iniciais(p.name)).toBe('LR');
  });

  it('código que não é da lista de papéis é ignorado', () => {
    for (const busca of ['?papel=admin', '?papel=Summary_Viewer', '?papel=', '?papel=__proto__']) {
      expect(perfilDaDemonstracao(busca), busca).toBe(PERFIL_DEMONSTRACAO);
    }
  });
});
