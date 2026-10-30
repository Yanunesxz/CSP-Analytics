import { describe, expect, it } from 'vitest';
import { permissoes, type Profile } from '@csp-mkt/shared';
import { PERFIL_DEMONSTRACAO } from '../../lib/auth';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { gerarDadosDeExemplo } from '../sample';
import { ACOES, PAPEIS, quadroDePermissoes, RESUMO_DO_PAPEL, ROTULO_DA_ACAO, usuarios } from './sistema';

const comPerfis = (profiles: Profile[]): Dados => ({ ...DADOS_VAZIOS, profiles });

const perfil = (id: string, name: string, role: Profile['role']): Profile => ({
  id,
  name,
  email: `${id}@example.com`,
  role,
});

describe('usuarios', () => {
  it('sem cadastro de acessos: lista vazia e contagens null (Sem dados), nunca 0', () => {
    const u = usuarios(comPerfis([]));
    expect(u.lista).toEqual([]);
    expect(u.total).toBeNull();
    expect(u.porPapel).toEqual({ owner: null, traffic_manager: null });
  });

  it('dados de exemplo: só o dono de demonstração, e 0 gestor de tráfego (contagem com base)', () => {
    const u = usuarios(gerarDadosDeExemplo({ agora: new Date('2026-10-30T15:00:00-03:00') }));
    expect(u.lista).toEqual([PERFIL_DEMONSTRACAO]);
    expect(u.total).toBe(1);
    expect(u.porPapel).toEqual({ owner: 1, traffic_manager: 0 });
  });

  it('dono primeiro e, dentro do papel, por nome', () => {
    const u = usuarios(
      comPerfis([
        perfil('g1', 'Perfil C', 'traffic_manager'),
        perfil('d2', 'Perfil B', 'owner'),
        perfil('g2', 'Perfil A', 'traffic_manager'),
        perfil('d1', 'Perfil A', 'owner'),
      ]),
    );
    expect(u.lista.map((p) => p.id)).toEqual(['d1', 'd2', 'g2', 'g1']);
    expect(u.total).toBe(4);
    expect(u.porPapel).toEqual({ owner: 2, traffic_manager: 2 });
  });

  it('não muda a lista recebida', () => {
    const profiles = [perfil('g1', 'Perfil B', 'traffic_manager'), perfil('d1', 'Perfil A', 'owner')];
    const antes = profiles.map((p) => p.id);
    usuarios(comPerfis(profiles));
    expect(profiles.map((p) => p.id)).toEqual(antes);
  });
});

describe('quadroDePermissoes', () => {
  const quadro = quadroDePermissoes();

  it('um cartão por papel, na ordem de labels.ts (dono primeiro)', () => {
    expect(PAPEIS).toEqual(['owner', 'traffic_manager']);
    expect(quadro.map((p) => p.papel)).toEqual(['owner', 'traffic_manager']);
    expect(quadro.map((p) => p.rotulo)).toEqual(['Dono', 'Gestor de tráfego']);
    expect(quadro.map((p) => p.resumo)).toEqual([RESUMO_DO_PAPEL.owner, RESUMO_DO_PAPEL.traffic_manager]);
  });

  it('o que pode é exatamente permissoes() de packages/shared, e pode + não pode cobre todas as ações', () => {
    for (const p of quadro) {
      const pode = p.pode.map((x) => x.acao);
      const naoPode = p.naoPode.map((x) => x.acao);
      expect([...pode].sort()).toEqual([...permissoes(p.papel)].sort());
      expect([...pode, ...naoPode].sort()).toEqual([...ACOES].sort());
      expect(pode.filter((a) => naoPode.includes(a))).toEqual([]);
    }
  });

  it('toda ação tem rótulo, e a ordem da tela é a de ROTULO_DA_ACAO', () => {
    for (const acao of ACOES) expect(ROTULO_DA_ACAO[acao].length).toBeGreaterThan(0);
    const dono = quadro.find((p) => p.papel === 'owner')!;
    const ordem = [...dono.pode, ...dono.naoPode].map((x) => x.acao);
    expect(ordem.filter((a) => a !== 'ver_lead_dado_pessoal')).toEqual(
      ACOES.filter((a) => a !== 'ver_lead_dado_pessoal'),
    );
  });

  it('ninguém vê dado pessoal de lead, com a nota do porquê', () => {
    for (const p of quadro) {
      const item = p.naoPode.find((x) => x.acao === 'ver_lead_dado_pessoal');
      expect(item?.nota).toMatch(/CSP 360/);
    }
  });

  it('o gestor de tráfego opera o Tráfego com IA, mas não gere usuários nem aprova ações', () => {
    const gestor = quadro.find((p) => p.papel === 'traffic_manager')!;
    expect(gestor.pode.map((x) => x.acao)).toContain('operar_trafego_ia');
    expect(gestor.naoPode.map((x) => x.acao)).toEqual(
      expect.arrayContaining(['gerir_usuarios', 'aprovar_acao', 'ver_diagnostico']),
    );
  });
});
