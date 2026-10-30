import { describe, expect, it } from 'vitest';
import {
  AVISOS,
  avisosDoPapel,
  CANAIS_DE_AVISO,
  comPreferencia,
  lerPreferencias,
  preferenciasPadrao,
  textoDoHorario,
} from './avisos';

describe('preferenciasPadrao', () => {
  it('e-mail ligado em todo aviso; WhatsApp ligado só no que é urgente (seção 8 do padrão)', () => {
    const padrao = preferenciasPadrao();
    for (const aviso of AVISOS) {
      expect(padrao[aviso.id].email).toBe(true);
      expect(padrao[aviso.id].whatsapp).toBe(aviso.urgente);
    }
  });

  it('cada chamada devolve um objeto novo (ninguém muda o padrão sem querer)', () => {
    expect(preferenciasPadrao()).not.toBe(preferenciasPadrao());
    expect(preferenciasPadrao()).toEqual(preferenciasPadrao());
  });

  it('os ids dos avisos não se repetem', () => {
    const ids = AVISOS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CANAIS_DE_AVISO.map((c) => c.canal)).toEqual(['email', 'whatsapp']);
  });
});

describe('lerPreferencias', () => {
  it('sem nada guardado, ou com texto que não é JSON de objeto, vale o padrão', () => {
    const padrao = preferenciasPadrao();
    for (const texto of [null, undefined, '', 'não é json', '[]', '42', 'null', '"texto"']) {
      expect(lerPreferencias(texto)).toEqual(padrao);
    }
  });

  it('usa o que foi guardado e completa o resto com o padrão', () => {
    const lido = lerPreferencias(JSON.stringify({ conector_parado: { whatsapp: false } }));
    expect(lido.conector_parado).toEqual({ email: true, whatsapp: false });
    expect(lido.relatorio_da_semana).toEqual(preferenciasPadrao().relatorio_da_semana);
  });

  it('ignora aviso desconhecido e valor que não é sim/não', () => {
    const lido = lerPreferencias(
      JSON.stringify({
        aviso_que_nao_existe: { email: false },
        relatorio_da_semana: { email: 'não', whatsapp: 1 },
        proposta_para_aprovar: [false, true],
      }),
    );
    expect(lido).toEqual(preferenciasPadrao());
    expect(Object.keys(lido)).not.toContain('aviso_que_nao_existe');
  });

  it('o que foi gravado volta igual na leitura', () => {
    const mudado = comPreferencia(preferenciasPadrao(), 'relatorio_da_semana', 'whatsapp', true);
    expect(lerPreferencias(JSON.stringify(mudado))).toEqual(mudado);
  });
});

describe('comPreferencia', () => {
  it('liga ou desliga só o canal pedido, sem mudar o objeto recebido', () => {
    const antes = preferenciasPadrao();
    const depois = comPreferencia(antes, 'conector_parado', 'email', false);
    expect(depois.conector_parado).toEqual({ email: false, whatsapp: true });
    expect(antes.conector_parado).toEqual({ email: true, whatsapp: true });
    expect(depois.gasto_perto_do_teto).toBe(antes.gasto_perto_do_teto);
  });
});

describe('avisosDoPapel', () => {
  it('o dono recebe todos', () => {
    expect(avisosDoPapel('owner').map((a) => a.id)).toEqual(AVISOS.map((a) => a.id));
  });

  it('o gestor de tráfego não recebe o que não pode fazer (aprovar proposta do Claude)', () => {
    const ids = avisosDoPapel('traffic_manager').map((a) => a.id);
    expect(ids).not.toContain('proposta_para_aprovar');
    expect(ids).toEqual(
      expect.arrayContaining(['conector_parado', 'gasto_perto_do_teto', 'relatorio_da_semana']),
    );
  });

  it('sem papel, nenhum aviso', () => {
    expect(avisosDoPapel(null)).toEqual([]);
    expect(avisosDoPapel(undefined)).toEqual([]);
  });
});

describe('textoDoHorario', () => {
  const aviso = (id: string) => AVISOS.find((a) => a.id === id)!;

  it('urgente sai a qualquer hora', () => {
    expect(textoDoHorario(aviso('conector_parado'))).toBe('Urgente: sai a qualquer hora.');
  });

  it('o que se repete no mesmo dia vira resumo; o relatório da semana não', () => {
    expect(textoDoHorario(aviso('proposta_para_aprovar'))).toBe(
      'Sai em horário comercial; vários no mesmo dia viram um resumo.',
    );
    expect(textoDoHorario(aviso('relatorio_da_semana'))).toBe('Sai em horário comercial.');
  });

  it('só agrupa o que não é urgente', () => {
    for (const a of AVISOS) if (a.urgente) expect(a.agrupa).toBe(false);
  });
});
