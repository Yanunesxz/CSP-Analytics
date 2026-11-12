import { describe, expect, it } from 'vitest';
import {
  enviarConvite,
  normalizarEmail,
  PAPEIS_DO_CONVITE,
  PAPEL_PADRAO_DO_CONVITE,
  validarConvite,
} from './convite';

describe('validarConvite', () => {
  const comAcesso = ['dono@example.com'];

  it('aceita maiúsculas e espaços em volta e grava em minúsculas (Postel)', () => {
    expect(normalizarEmail('  Gestor@Example.COM ')).toBe('gestor@example.com');
    expect(validarConvite('  Gestor@Example.COM ', 'traffic_manager', comAcesso)).toEqual({
      ok: true,
      convite: { email: 'gestor@example.com', papel: 'traffic_manager' },
    });
  });

  it('pede o e-mail quando o campo está vazio ou só com espaços', () => {
    expect(validarConvite('', 'traffic_manager', comAcesso)).toEqual({
      ok: false,
      erro: 'Informe o e-mail da pessoa.',
    });
    expect(validarConvite('   ', 'owner', comAcesso).ok).toBe(false);
  });

  it('mostra o formato certo quando o e-mail não é válido', () => {
    for (const invalido of ['gestor', 'gestor@', '@example.com', 'gestor@example', 'ges tor@example.com']) {
      const v = validarConvite(invalido, 'traffic_manager', comAcesso);
      expect(v).toEqual({ ok: false, erro: 'Informe um e-mail válido, como nome@empresa.com.br.' });
    }
  });

  it('avisa quando o e-mail já tem acesso, sem diferenciar maiúsculas', () => {
    expect(validarConvite('DONO@example.com', 'owner', comAcesso)).toEqual({
      ok: false,
      erro: 'Este e-mail já tem acesso ao sistema.',
    });
    expect(validarConvite('dono@example.com', 'owner', ['  Dono@Example.com ']).ok).toBe(false);
  });

  it('o convite oferece os dois papéis, com o gestor de tráfego como padrão', () => {
    expect([...PAPEIS_DO_CONVITE].sort()).toEqual(['owner', 'summary_viewer', 'traffic_manager']);
    expect(PAPEL_PADRAO_DO_CONVITE).toBe('traffic_manager');
    expect(PAPEIS_DO_CONVITE[0]).toBe(PAPEL_PADRAO_DO_CONVITE);
  });
});

describe('enviarConvite', () => {
  const convite = { email: 'gestor@example.com', papel: 'traffic_manager' as const };

  it('na demonstração, simula o envio e devolve o e-mail para o aviso', async () => {
    await expect(enviarConvite(convite, { modo: 'demonstracao', esperarMs: 0 })).resolves.toEqual({
      ok: true,
      email: 'gestor@example.com',
    });
  });

  it('com Supabase, enquanto o envio não existe, devolve erro com código (sem fingir que enviou)', async () => {
    const r = await enviarConvite(convite, { modo: 'supabase', esperarMs: 0 });
    expect(r).toEqual({
      ok: false,
      codigo: 'USR-501',
      mensagem: 'O envio de convites por e-mail ainda não está ligado.',
    });
  });
});
