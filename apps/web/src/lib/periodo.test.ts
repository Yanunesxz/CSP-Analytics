import { describe, expect, it } from 'vitest';
import { intervaloDoPeriodo } from './periodo';

const agora = new Date('2026-10-30T15:00:00-03:00');

describe('intervaloDoPeriodo', () => {
  it('este mês vai do dia 1 até hoje e compara com os mesmos dias do mês anterior (decisão 0026)', () => {
    expect(intervaloDoPeriodo('este-mes', new Date('2026-11-03T15:00:00-03:00'))).toMatchObject({
      inicio: '2026-11-01',
      fim: '2026-11-03',
      anteriorInicio: '2026-10-01',
      anteriorFim: '2026-10-03',
      dias: 3,
      rotuloAnterior: 'vs. 1º a 3 de outubro',
    });
    // Mês anterior mais curto: para no último dia dele.
    expect(intervaloDoPeriodo('este-mes', new Date('2026-03-31T15:00:00-03:00'))).toMatchObject({
      anteriorInicio: '2026-02-01',
      anteriorFim: '2026-02-28',
      rotuloAnterior: 'vs. 1º a 28 de fevereiro',
    });
    // Dia 1: compara com o dia 1 do mês anterior.
    expect(intervaloDoPeriodo('este-mes', new Date('2026-11-01T09:00:00-03:00'))).toMatchObject({
      anteriorInicio: '2026-10-01',
      anteriorFim: '2026-10-01',
      dias: 1,
      rotuloAnterior: 'vs. 1º de outubro',
    });
    // No fim do mês, os mesmos dias são o mês anterior inteiro.
    expect(intervaloDoPeriodo('este-mes', agora)).toMatchObject({
      inicio: '2026-10-01',
      fim: '2026-10-30',
      anteriorInicio: '2026-09-01',
      anteriorFim: '2026-09-30',
      dias: 30,
      rotuloAnterior: 'vs. 1º a 30 de setembro',
    });
  });

  it('mês passado é o mês inteiro e compara com o retrasado', () => {
    const i = intervaloDoPeriodo('mes-passado', agora);
    expect(i).toMatchObject({
      inicio: '2026-09-01',
      fim: '2026-09-30',
      anteriorInicio: '2026-08-01',
      anteriorFim: '2026-08-31',
      dias: 30,
    });
  });

  it('janelas de N dias terminam hoje e comparam com os N dias anteriores', () => {
    expect(intervaloDoPeriodo('7d', agora)).toMatchObject({
      inicio: '2026-10-24',
      fim: '2026-10-30',
      anteriorInicio: '2026-10-17',
      anteriorFim: '2026-10-23',
      dias: 7,
    });
    expect(intervaloDoPeriodo('30d', agora)).toMatchObject({
      inicio: '2026-10-01',
      fim: '2026-10-30',
      anteriorInicio: '2026-09-01',
      anteriorFim: '2026-09-30',
    });
    expect(intervaloDoPeriodo('90d', agora)).toMatchObject({
      inicio: '2026-08-02',
      fim: '2026-10-30',
      dias: 90,
    });
  });

  it('usa o dia de São Paulo, não o UTC', () => {
    // 23:30 em São Paulo de 30/10 é 02:30 UTC de 31/10
    const i = intervaloDoPeriodo('este-mes', new Date('2026-10-30T23:30:00-03:00'));
    expect(i.fim).toBe('2026-10-30');
    // 00:30 de 1º/11 em São Paulo ainda é 31/10 em UTC: o mês já é novembro, e o anterior é só o dia 1 (0026)
    const j = intervaloDoPeriodo('este-mes', new Date('2026-11-01T00:30:00-03:00'));
    expect(j).toMatchObject({
      inicio: '2026-11-01',
      fim: '2026-11-01',
      anteriorInicio: '2026-10-01',
      anteriorFim: '2026-10-01',
    });
  });

  it('virada de ano no mês passado', () => {
    const i = intervaloDoPeriodo('mes-passado', new Date('2027-01-15T12:00:00-03:00'));
    expect(i).toMatchObject({
      inicio: '2026-12-01',
      fim: '2026-12-31',
      anteriorInicio: '2026-11-01',
      anteriorFim: '2026-11-30',
    });
  });
});
