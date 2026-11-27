"""Adaptador e rodada do CSP 360 com respostas inventadas no formato da API de dados do CRM (sem rede)."""

import base64
import json
from datetime import date
from pathlib import Path

import pytest

from csp_worker.crm import Conversor, centavos, resumo_do_login
from csp_worker.crm_http import VIEWS, ErroDoCrm, chamada_do_crm, diagnostico_do_token, por_chave, por_ids
from csp_worker.rodada_crm import inicio_da_janela, rodar

CHAVE = b"k" * 32
CS, PL = "00000000-0000-0000-0000-0000000000c5", "00000000-0000-0000-0000-0000000000b1"
FUNIL = "f0000000-0000-0000-0000-000000000001"
CLI1, CLI2 = "c0000000-0000-0000-0000-000000000001", "c0000000-0000-0000-0000-000000000002"
USU = "u0000000-0000-0000-0000-000000000001"


def dados():
    return {
        "marcas": [
            {"id": CS, "sigla": "CS", "nome_fantasia": "Corpo Sensual"},
            {"id": PL, "sigla": "PL", "nome_fantasia": "Plumene"},
        ],
        "funis_venda": [{"id": FUNIL, "nome": "Funil de Vendas", "padrao": True}],
        "usuarios": [{"id": USU, "papel": "vendedor-interno", "ativo": True, "logins_app": [f"{CS}:42", f"{PL}:"]}],
        "clientes": [
            {
                "id": CLI1,
                "codigo": "CLI-1",
                "status": "prospecto",
                "criado_em": "2026-11-20T12:00:00Z",
                "retrato_carregado": None,
                "donos_app": None,
            },
            {
                "id": CLI2,
                "codigo": "CLI-2",
                "status": "ativo",
                "criado_em": "2026-09-01T00:00:00Z",
                "retrato_carregado": True,
                "donos_app": [f"{CS}:42"],
            },
        ],
        "clientes_utm": [{"cliente_id": CLI1, "utm_source": "meta", "utm_medium": "cpc", "utm_campaign": "120200"}],
        "clientes_compras_marca": [
            {
                "cliente_id": CLI2,
                "marca_id": CS,
                "primeira_compra": None,
                "ultima_compra": "2025-03-10",
                "total_comprado": "1234.565",
            },
        ],
        "negocios": [
            {
                "id": "n1",
                "codigo": "NEG-1",
                "cliente_id": CLI1,
                "marca_id": CS,
                "funil_id": FUNIL,
                "origem": "meta",
                "criado_em": "2026-11-26T10:00:00Z",
                "atualizado_em": "2026-11-26T10:00:00Z",
            },
        ],
        "negocios_responsavel": [{"negocio_id": "n1", "responsavel_id": USU}],
        "leads_sdr": [{"id": "s1", "criado_em": "2026-11-26T11:00:00Z", "atualizado_em": None, "cliente_id": CLI2}],
        "pedidos": [
            {
                "id": "p1",
                "marca_id": CS,
                "cliente_id": CLI1,
                "status": "faturado",
                "criado_em": "2026-11-26T12:00:00Z",
                "atualizado_em": "2026-11-26T12:00:00Z",
                "vendedor_app": f"{CS}:42",
            },
            {
                "id": "p2",
                "marca_id": "outra",
                "cliente_id": CLI1,
                "status": "enviado",
                "criado_em": None,
                "atualizado_em": None,
                "vendedor_app": None,
            },
        ],
        "pedido_itens": [
            {"pedido_id": "p1", "quantidade": 3, "preco_unitario": "10.10"},
            {"pedido_id": "p1", "quantidade": 1, "preco_unitario": 0.005},
        ],
        "sincronizacoes": [
            {
                "id": "y1",
                "marca_id": CS,
                "disparo": "cron",
                "iniciada_em": "2026-11-27T12:00:00Z",
                "terminada_em": "2026-11-27T12:00:05Z",
                "ok": True,
            },
            {
                "id": "y2",
                "marca_id": CS,
                "disparo": "cron",
                "iniciada_em": "2026-11-27T12:10:00Z",
                "terminada_em": None,
                "ok": None,
            },
        ],
    }


def chamada_falsa(tabelas, erro=None):
    feitas = []

    def chamar(view, parametros):
        feitas.append((view, dict(parametros)))
        assert parametros["select"] == ",".join(VIEWS[view])  # sempre a lista exata de colunas
        if erro is not None:
            raise erro
        if parametros.get("limit") == "0":
            return []
        linhas = list(tabelas.get(view, []))
        for coluna in ("id", "cliente_id", "negocio_id", "pedido_id"):
            filtro = parametros.get(coluna, "")
            if filtro.startswith("in.("):
                ids = set(filtro[4:-1].split(","))
                linhas = [x for x in linhas if str(x[coluna]) in ids]
            elif filtro.startswith("gt."):
                linhas = [x for x in linhas if str(x[coluna]) > filtro[3:]]
        return linhas[: int(parametros.get("limit", 1000))]

    chamar.feitas = feitas
    return chamar


class BancoFalso:
    def __init__(self, recusar=None, segurar=None):
        self.gravado = {}
        self.fechada = None
        self.apagadas = []
        self.recusar = recusar or {}
        self.segurar = segurar

    def abrir_rodada(self, conector, trabalho, gatilho):
        self.trabalho = (conector, trabalho, gatilho)
        return "rodada-1"

    def gravar(self, rodada, funcao, linhas):
        self.gravado.setdefault(funcao, []).extend(linhas)
        return self.recusar.get(funcao, [])

    def apagar_o_que_sumiu(self, tabela, rodada):
        self.apagadas.append(tabela)
        return (0, "MASS_DELETE_BLOCKED") if tabela == self.segurar else (1, None)

    def fechar_rodada(self, rodada, status, codigo=None, mensagem=None):
        self.fechada = (status, codigo, mensagem)


def test_centavos_em_decimal_e_meio_centavo_para_cima():
    assert centavos("1234.565") == 123457
    assert centavos(0.005) == 1
    assert centavos("abc") is None
    assert centavos(None) is None


def test_login_vira_resumo_e_vazio_nao_e_login():
    marca, resumo = resumo_do_login(CHAVE, f"{CS}:42")
    assert marca == CS and len(resumo) == 64 and "42" not in resumo
    assert resumo_do_login(CHAVE, f"{CS}:") is None
    assert resumo_do_login(CHAVE, "") is None
    assert resumo_do_login(CHAVE, None) is None


def test_passada_completa_grava_tudo_na_ordem_e_apaga_o_que_sumiu():
    banco = BancoFalso()
    r = rodar(banco, chamada_falsa(dados()), Conversor(CHAVE), True, date(2026, 11, 27))
    assert banco.trabalho == ("csp360", "crm_full_pass", "schedule")
    assert r.status == "succeeded" and banco.fechada == ("succeeded", None, None)
    assert list(banco.gravado) == [
        "upsert_brands", "upsert_crm_funnels", "upsert_sales_reps", "upsert_sales_rep_app_logins",
        "upsert_crm_customers", "upsert_crm_customer_brands", "upsert_crm_customer_reps", "upsert_crm_leads",
        "upsert_crm_orders", "upsert_crm_upstream_runs",
    ]  # fmt: skip
    assert [b["brand"] for b in banco.gravado["upsert_brands"]] == ["cs", "plumene"]
    assert banco.gravado["upsert_sales_reps"][0]["values"]["crm_role"] == "internal_seller"
    assert len(banco.gravado["upsert_sales_rep_app_logins"]) == 1  # o login sem id foi descartado

    clientes = {c["key"]["external_id"]: c["values"] for c in banco.gravado["upsert_crm_customers"]}
    assert clientes[CLI1]["first_utm_campaign"] == "120200" and clientes[CLI1]["crm_status"] == "prospect"
    assert clientes[CLI1]["is_known_by_erp"] is False and clientes[CLI2]["has_app_owner"] is True
    compra = banco.gravado["upsert_crm_customer_brands"][0]
    assert compra["brand"] == "cs" and compra["values"]["erp_total_purchased_cents"] == 123457

    leads = banco.gravado["upsert_crm_leads"]
    assert leads[0]["key"] == {"kind": "deal", "external_id": "n1"}
    assert leads[0]["values"]["assigned_rep_external_id"] == USU and leads[0]["brand"] == "cs"
    assert leads[1]["key"]["kind"] == "sdr" and "brand" not in leads[1]

    pedidos = banco.gravado["upsert_crm_orders"]
    assert len(pedidos) == 1  # pedido de marca desconhecida fica de fora
    assert pedidos[0]["values"]["status"] == "sent" and pedidos[0]["values"]["is_invoiced"] is True
    assert pedidos[0]["values"]["total_cents"] == 3031  # 3 × 10,10 + 0,005 arredondado
    assert len(pedidos[0]["values"]["sales_rep_app_login_key"]) == 64

    assert [s["key"]["external_id"] for s in banco.gravado["upsert_crm_upstream_runs"]] == ["y1"]
    assert banco.apagadas[0] == "crm_orders" and banco.apagadas[-1] == "crm_funnels" and r.apagadas == 8


def test_nenhum_evento_leva_texto_pessoal_ou_login_em_claro():
    banco = BancoFalso()
    rodar(banco, chamada_falsa(dados()), Conversor(CHAVE), True, date(2026, 11, 27))
    texto = repr(banco.gravado)
    assert f"{CS}:42" not in texto


def test_rodada_de_5_min_le_a_janela_e_so_os_clientes_citados():
    tabelas = dados()
    chamar = chamada_falsa(tabelas)
    banco = BancoFalso()
    r = rodar(banco, chamar, Conversor(CHAVE), False, date(2026, 11, 27))
    assert banco.trabalho[1] == "crm_incremental" and r.status == "succeeded"
    assert banco.apagadas == []
    pedidos_negocios = [p for v, p in chamar.feitas if v == "negocios" and p.get("limit") != "0"]
    assert pedidos_negocios[0]["atualizado_em"] == "gte.2026-11-25T00:00:00Z"
    pedidos = [p for v, p in chamar.feitas if v == "pedidos" and p.get("limit") != "0"]
    assert "atualizado_em.is.null" in pedidos[0]["or"]
    clientes = [p for v, p in chamar.feitas if v == "clientes" and p.get("limit") != "0"]
    assert clientes[0]["id"] == f"in.({CLI1},{CLI2})"


def test_view_que_mudou_falha_antes_de_gravar():
    banco = BancoFalso()
    erro = ErroDoCrm("SCHEMA_DRIFT", "negocios: a view ou uma coluna mudou no CRM (42703)")
    r = rodar(banco, chamada_falsa(dados(), erro=erro), Conversor(CHAVE), True, date(2026, 11, 27))
    assert r.status == "failed" and banco.fechada[1] == "SCHEMA_DRIFT"
    assert banco.gravado == {} and banco.apagadas == []


def test_passada_com_fonte_vazia_falha_sem_apagar():
    tabelas = dados()
    tabelas["pedidos"] = []
    banco = BancoFalso()
    r = rodar(banco, chamada_falsa(tabelas), Conversor(CHAVE), True, date(2026, 11, 27))
    assert r.status == "failed" and r.codigo == "EMPTY_SOURCE"
    assert banco.apagadas == []


def test_exclusao_em_massa_segurada_termina_partial():
    banco = BancoFalso(segurar="crm_leads")
    r = rodar(banco, chamada_falsa(dados()), Conversor(CHAVE), True, date(2026, 11, 27))
    assert r.status == "partial" and banco.fechada[1] == "MASS_DELETE_BLOCKED"


def test_linha_recusada_termina_partial_com_o_codigo():
    banco = BancoFalso(recusar={"upsert_crm_leads": ["UNKNOWN_CUSTOMER"]})
    r = rodar(banco, chamada_falsa(dados()), Conversor(CHAVE), False, date(2026, 11, 27))
    assert r.status == "partial" and banco.fechada[1] == "UNKNOWN_CUSTOMER"


def test_janela_de_3_dias_em_utc():
    assert inicio_da_janela(date(2026, 12, 1)) == "2026-11-29T00:00:00Z"


def test_paginacao_por_chave_pede_o_que_vem_depois():
    linhas = [{"id": f"{i:03d}"} for i in range(5)]
    feitas = []

    def chamar(view, p):
        feitas.append(p)
        resto = [x for x in linhas if "id" not in p or x["id"] > p["id"][3:]]
        return resto[: int(p["limit"])]

    assert [x["id"] for x in por_chave(chamar, "marcas", pagina=2)] == ["000", "001", "002", "003", "004"]
    assert [p.get("id") for p in feitas] == [None, "gt.001", "gt.003"]


def test_lote_que_enche_a_pagina_e_dividido():
    itens = [{"pedido_id": "a"}] * 2 + [{"pedido_id": "b"}] * 2

    def chamar(view, p):
        ids = p["pedido_id"][4:-1].split(",")
        return [x for x in itens if x["pedido_id"] in ids][: int(p["limit"])]

    assert len(list(por_ids(chamar, "pedido_itens", "pedido_id", ["a", "b"], pagina=3))) == 4
    with pytest.raises(ErroDoCrm):
        list(por_ids(chamar, "pedido_itens", "pedido_id", ["a"], pagina=2))


class Resposta:
    def __init__(self, status, corpo):
        self.status_code = status
        self._corpo = corpo

    def json(self):
        return self._corpo


class Sessao:
    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.pedidos = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.pedidos.append((url, params, headers))
        return self.respostas.pop(0)


def test_chamada_leva_o_esquema_e_o_token_e_traduz_os_erros():
    sessao = Sessao([Resposta(200, [{"id": "1"}])])
    chamar = chamada_do_crm("https://abc.supabase.co/", "anon", "segredo", sessao=sessao, dormir=lambda s: None)
    assert chamar("marcas", {"select": "id"}) == [{"id": "1"}]
    url, _, cabecalhos = sessao.pedidos[0]
    assert url == "https://abc.supabase.co/rest/v1/marcas"
    assert cabecalhos["Accept-Profile"] == "csp_mkt" and cabecalhos["Authorization"] == "Bearer segredo"

    for status, codigo, esperado in (
        (400, "42703", "SCHEMA_DRIFT"),
        (406, "PGRST106", "SCHEMA_NOT_EXPOSED"),
        (401, "PGRST301", "TOKEN_INVALID"),
        (403, "42501", "PERMISSION"),
    ):
        sessao = Sessao([Resposta(status, {"code": codigo, "message": "segredo vazado?"})])
        chamar = chamada_do_crm("https://abc.supabase.co", "anon", "segredo", sessao=sessao, dormir=lambda s: None)
        with pytest.raises(ErroDoCrm) as e:
            chamar("marcas", {"select": "id"})
        assert e.value.codigo == esperado and "segredo" not in str(e.value)


def test_erro_do_servidor_repete_e_depois_desiste():
    sessao = Sessao([Resposta(503, {})] * 4 + [Resposta(200, [])])
    chamar = chamada_do_crm("https://abc.supabase.co", "anon", "t", sessao=sessao, dormir=lambda s: None)
    assert chamar("marcas", {"select": "id"}) == []


def test_configuracao_que_falta_para_antes_de_chamar():
    with pytest.raises(ErroDoCrm) as e:
        chamada_do_crm("", "anon", "t")
    assert e.value.codigo == "CONFIG"
    with pytest.raises(ErroDoCrm) as e:
        chamada_do_crm("https://abc.supabase.co", "anon", "")
    assert e.value.codigo == "AUTH"


CONTRATO = Path(__file__).parents[3] / "supabase" / "tests" / "fixtures" / "crm-eventos.json"


def test_eventos_iguais_ao_contrato_do_banco():
    """supabase/tests/conector-crm.test.ts grava estes mesmos eventos pelas funções ingest.* do banco."""
    banco = BancoFalso()
    rodar(banco, chamada_falsa(dados()), Conversor(CHAVE), True, date(2026, 11, 27))
    assert banco.gravado == json.loads(CONTRATO.read_text(encoding="utf-8"))


def _token(claims, alg="HS256"):
    def parte(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")

    return f"{parte({'alg': alg, 'typ': 'JWT'})}.{parte(claims)}.assinatura-secreta"


def test_token_colado_com_aspas_e_espaco_vai_limpo():
    sessao = Sessao([Resposta(200, [])])
    url = ' "https://abc.supabase.co" '
    chamar = chamada_do_crm(url, "'anon'\n", ' "tok" \n', sessao=sessao, dormir=lambda s: None)
    chamar("marcas", {"select": "id"})
    url, _, cabecalhos = sessao.pedidos[0]
    assert url == "https://abc.supabase.co/rest/v1/marcas"
    assert cabecalhos["apikey"] == "anon" and cabecalhos["Authorization"] == "Bearer tok"


def test_token_recusado_diz_o_que_e_sem_mostrar_a_assinatura():
    token = _token({"role": "csp_mkt_api_abc12345", "exp": 2_000_000_000})
    assert diagnostico_do_token(token, agora=1_900_000_000) == "token HS256, papel csp_mkt_api_abc12345, no prazo"
    assert "vencido" in diagnostico_do_token(token, agora=2_100_000_000)
    assert "outro papel" in diagnostico_do_token(_token({"role": "service_role"}))
    assert "2 partes" in diagnostico_do_token("abc.def")

    sessao = Sessao([Resposta(401, {"code": "PGRST301"})])
    chamar = chamada_do_crm("https://abc.supabase.co", "anon", token, sessao=sessao, dormir=lambda s: None)
    with pytest.raises(ErroDoCrm) as e:
        chamar("marcas", {"select": "id"})
    assert "papel csp_mkt_api_abc12345" in str(e.value) and "assinatura" not in str(e.value)
