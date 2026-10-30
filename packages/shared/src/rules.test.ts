import { describe, expect, it } from 'vitest';
import { ROTAS_PROTEGIDAS, classificarOrigem, codigo, ehAssistenteDeIa, permissoes, pode } from './rules';

describe('classificarOrigem', () => {
  it('UTM paga vence o referrer', () => {
    expect(classificarOrigem('www.google.com', 'google', 'cpc')).toBe('google');
    expect(classificarOrigem(null, 'facebook', 'paid_social')).toBe('meta');
    expect(classificarOrigem(null, 'Instagram', 'cpc')).toBe('meta');
    expect(classificarOrigem(null, 'tiktok', 'cpc')).toBe('tiktok');
  });

  it('google ou bing sem meio pago é busca orgânica', () => {
    expect(classificarOrigem('www.google.com', null, null)).toBe('organic');
    expect(classificarOrigem('www.google.com.br', null, null)).toBe('organic');
    expect(classificarOrigem('www.bing.com', null, null)).toBe('organic');
    expect(classificarOrigem(null, 'google', 'organic')).toBe('organic');
    expect(classificarOrigem(null, 'google', null)).toBe('organic');
  });

  it('assistentes de IA pelo referrer ou pela UTM', () => {
    for (const h of [
      'chatgpt.com',
      'www.perplexity.ai',
      'claude.ai',
      'gemini.google.com',
      'copilot.microsoft.com',
    ]) {
      expect(classificarOrigem(h, null, null), h).toBe('ai_assistant');
    }
    expect(classificarOrigem('https://chatgpt.com/c/abc', null, null)).toBe('ai_assistant');
    expect(classificarOrigem(null, 'chatgpt', 'referral')).toBe('ai_assistant');
    expect(ehAssistenteDeIa('perplexity.ai')).toBe(true);
    expect(ehAssistenteDeIa('www.google.com')).toBe(false);
  });

  it('sem UTM e sem referrer é direto; próprio site é site; outro site é indicação', () => {
    expect(classificarOrigem(null, null, null)).toBe('direct');
    expect(classificarOrigem('', '', '')).toBe('direct');
    expect(classificarOrigem('www.corposensual.com.br', null, null)).toBe('site');
    expect(classificarOrigem('blog.exemplo.com.br', null, null)).toBe('referral');
    expect(classificarOrigem('l.facebook.com', null, null)).toBe('referral');
  });

  it('redirecionador do Google Ads conta como Google Ads', () => {
    expect(classificarOrigem('googleads.g.doubleclick.net', null, null)).toBe('google');
  });

  it('UTM desconhecida é indicação; sdr e whatsapp são SDR', () => {
    expect(classificarOrigem(null, 'newsletter', 'email')).toBe('referral');
    expect(classificarOrigem(null, 'sdr', null)).toBe('sdr');
    expect(classificarOrigem(null, 'whatsapp', null)).toBe('sdr');
  });
});

describe('permissoes', () => {
  it('owner faz tudo, menos ver dado pessoal de lead', () => {
    const p = permissoes('owner');
    expect(p).toContain('ver_trafego_ia');
    expect(p).toContain('aprovar_acao');
    expect(p).toContain('gerir_usuarios');
    expect(p).toContain('ver_diagnostico');
    expect(p).not.toContain('ver_lead_dado_pessoal');
  });

  it('traffic_manager vê números e opera o Tráfego com IA, sem usuários nem diagnóstico', () => {
    expect(pode('traffic_manager', 'ver_numeros')).toBe(true);
    expect(pode('traffic_manager', 'ver_trafego_ia')).toBe(true);
    expect(pode('traffic_manager', 'operar_trafego_ia')).toBe(true);
    expect(pode('traffic_manager', 'aprovar_acao')).toBe(false);
    expect(pode('traffic_manager', 'parar_tudo')).toBe(false);
    expect(pode('traffic_manager', 'gerir_usuarios')).toBe(false);
    expect(pode('traffic_manager', 'ver_diagnostico')).toBe(false);
    expect(pode('traffic_manager', 'ver_lead_dado_pessoal')).toBe(false);
  });

  it('ninguém vê lead com dado pessoal; sem papel não pode nada', () => {
    expect(pode('owner', 'ver_lead_dado_pessoal')).toBe(false);
    expect(permissoes(null)).toEqual([]);
    expect(pode(undefined, 'ver_numeros')).toBe(false);
  });

  it('rotas protegidas apontam para ações que existem', () => {
    expect(ROTAS_PROTEGIDAS['/trafego']).toBe('ver_trafego_ia');
    expect(ROTAS_PROTEGIDAS['/leads']).toBe('ver_leads');
    expect(ROTAS_PROTEGIDAS['/conectores']).toBe('ver_conectores');
    expect(pode('owner', ROTAS_PROTEGIDAS['/diagnostico']!)).toBe(true);
    expect(pode('traffic_manager', ROTAS_PROTEGIDAS['/diagnostico']!)).toBe(false);
    // O dono abre todas as rotas protegidas
    expect(Object.values(ROTAS_PROTEGIDAS).every((acao) => pode('owner', acao))).toBe(true);
  });
});

describe('codigo', () => {
  it('formata PREFIXO-0001', () => {
    expect(codigo('LEAD', 1)).toBe('LEAD-0001');
    expect(codigo('CLI', 12345)).toBe('CLI-12345');
  });
});
