"""Adaptador e rodada da Meta com respostas inventadas no formato da Marketing API (sem rede)."""

from datetime import date

import pytest

from csp_worker.meta import (
    ErroDaMeta,
    Janela,
    centavos,
    id_da_conta,
    janela_de_releitura,
    ler_campanhas,
    ler_conta,
    ler_gasto,
)
from csp_worker.meta_http import chamada_da_meta
from csp_worker.rodada_meta import rodar

JANELA = Janela(inicio=date(2026, 11, 24), fim=date(2026, 11, 25))


def chamada_falsa(respostas):
    feitas = []

    def chamar(caminho, parametros):
        feitas.append((caminho, parametros))
        for prefixo, resposta in respostas.items():
            if caminho.endswith(prefixo):
                if isinstance(resposta, Exception):
                    raise resposta
                return resposta
        raise AssertionError(f"chamada inesperada: {caminho}")

    chamar.feitas = feitas
    return chamar


CONTA = {
    "name": "CS Anúncios",
    "currency": "BRL",
    "timezone_name": "America/Sao_Paulo",
    "account_status": 1,
    "spend_cap": "0",
    "amount_spent": "1234567",
}
CAMPANHAS = {
    "data": [
        {"id": "111", "name": "Topo", "effective_status": "ACTIVE", "daily_budget": "5000"},
        {"id": "222", "name": "Antiga", "effective_status": "ARCHIVED", "created_time": "2026-08-01T10:00:00-0300"},
    ]
}
INSIGHTS = {
    "data": [
        {
            "campaign_id": "111",
            "date_start": "2026-11-24",
            "spend": "533.955",
            "impressions": "18120",
            "inline_link_clicks": "402",
            "actions": [{"action_type": "lead", "value": "3"}, {"action_type": "purchase", "value": "1"}],
            "action_values": [{"action_type": "purchase", "value": "199.90"}],
        },
        {"campaign_id": "222", "date_start": "2026-11-24", "spend": "10", "impressions": "5"},
    ]
}


def test_centavos_sem_ponto_flutuante_e_meio_centavo_para_cima():
    assert centavos("533.955") == 53396
    assert centavos("0.1") == 10
    assert centavos(None) == 0
    assert centavos("") == 0


def test_conta_aceita_com_e_sem_prefixo():
    assert id_da_conta("act_123") == "act_123"
    assert id_da_conta("123") == "act_123"
    with pytest.raises(ErroDaMeta):
        id_da_conta("abc")


def test_janela_de_releitura_inclui_hoje():
    j = janela_de_releitura(date(2026, 11, 26), 2)
    assert (j.inicio, j.fim) == (date(2026, 11, 25), date(2026, 11, 26))


def test_conta_vira_evento_com_teto_e_gasto_em_centavos():
    e = ler_conta(chamada_falsa({"/act_9": CONTA}), "9", "cs")
    assert e["kind"] == "ad_account"
    assert e["key"] == {"external_id": "9"}
    assert e["values"]["spend_cap_cents"] == 0
    assert e["values"]["amount_spent_cents"] == 1234567
    assert e["values"]["is_active"] is True


def test_campanhas_trazem_arquivadas_e_status_do_banco():
    chamar = chamada_falsa({"/campaigns": CAMPANHAS})
    eventos = ler_campanhas(chamar, "act_9", "cs")
    assert [(e["key"]["external_id"], e["values"]["status"]) for e in eventos] == [("111", "active"), ("222", "ended")]
    assert eventos[0]["values"]["daily_budget_cents"] == 5000
    assert eventos[1]["values"]["daily_budget_cents"] is None
    assert "ARCHIVED" in chamar.feitas[0][1]["effective_status"]


def test_gasto_por_dia_com_todos_os_dias_da_janela():
    por_dia = ler_gasto(chamada_falsa({"/insights": INSIGHTS}), "9", "cs", JANELA)
    assert set(por_dia) == {"2026-11-24", "2026-11-25"}
    assert por_dia["2026-11-25"] == []
    v = por_dia["2026-11-24"][0]["values"]
    assert v == {
        "spend_cents": 53396,
        "impressions": 18120,
        "clicks": 402,
        "platform_leads": 3,
        "conversions": "1",
        "conversion_value_cents": 19990,
    }


def test_paginacao_segue_o_next():
    pagina2 = {"data": [{"id": "333", "name": "C", "effective_status": "PAUSED"}]}
    chamar = chamada_falsa(
        {
            "/campaigns": {"data": CAMPANHAS["data"], "paging": {"next": "https://graph.facebook.com/x?after=Z"}},
            "after=Z": pagina2,
        }
    )
    assert len(ler_campanhas(chamar, "9", "cs")) == 3


class BancoFalso:
    def __init__(self, contas, recusar_conta=False):
        from csp_worker.banco import ContaDeAnuncio

        self.contas = [ContaDeAnuncio(external_id=c, marca=m) for c, m in contas]
        self.recusar_conta = recusar_conta
        self.gravados = []
        self.dias = []
        self.fechada = None

    def contas_meta(self):
        return self.contas

    def abrir_rodada(self, conector, trabalho, gatilho):
        self.aberta = (conector, trabalho, gatilho)
        return "r1"

    def gravar(self, rodada, funcao, linhas):
        self.gravados.append((funcao, len(linhas)))
        if funcao == "upsert_ad_accounts" and self.recusar_conta:
            return ["CURRENCY"]
        return []

    def trocar_dia_de_anuncio(self, rodada, conta, dia, linhas):
        self.dias.append((conta, dia, len(linhas)))
        return []

    def fechar_rodada(self, rodada, status, codigo=None, mensagem=None):
        self.fechada = (status, codigo)


RESPOSTAS = {"/act_9": CONTA, "/campaigns": CAMPANHAS, "/insights": INSIGHTS}


def test_rodada_grava_conta_campanhas_e_troca_cada_dia():
    banco = BancoFalso([("9", "cs")])
    r = rodar(banco, chamada_falsa(RESPOSTAS), JANELA)
    assert banco.aberta == ("meta", "ads_backfill", "backfill")
    assert banco.gravados == [("upsert_ad_accounts", 1), ("upsert_campaigns", 2)]
    assert banco.dias == [("9", "2026-11-24", 2), ("9", "2026-11-25", 0)]
    assert r.status == "succeeded" and banco.fechada == ("succeeded", None)
    assert r.linhas == 5


def test_sem_conta_cadastrada_nao_abre_rodada():
    r = rodar(BancoFalso([]), chamada_falsa({}), JANELA)
    assert r.status == "skipped"


def test_conta_em_outra_moeda_nao_le_gasto_e_rodada_falha():
    banco = BancoFalso([("9", "cs")], recusar_conta=True)
    r = rodar(banco, chamada_falsa(RESPOSTAS), JANELA)
    assert banco.dias == []
    assert r.status == "failed" and r.codigo == "CURRENCY"


def test_uma_conta_falha_e_a_outra_segue():
    respostas = {**RESPOSTAS, "/act_8": ErroDaMeta("PERMISSION", "sem permissão")}
    banco = BancoFalso([("8", "plumene"), ("9", "cs")])
    r = rodar(banco, chamada_falsa(respostas), JANELA, "ads_hourly")
    assert banco.aberta == ("meta", "ads_hourly", "schedule")
    assert r.status == "partial" and r.codigo == "PERMISSION"
    assert len(banco.dias) == 2


class Resposta:
    def __init__(self, status, corpo):
        self.status_code = status
        self._corpo = corpo

    def json(self):
        return self._corpo


class SessaoFalsa:
    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.pedidos = []

    def get(self, url, params=None, timeout=None):
        self.pedidos.append((url, params))
        return self.respostas.pop(0)


def test_http_manda_appsecret_proof_e_nunca_o_token_no_erro():
    sessao = SessaoFalsa([Resposta(400, {"error": {"code": 190, "message": "token SEGREDO inválido"}})])
    chamar = chamada_da_meta("SEGREDO", "app", sessao=sessao, dormir=lambda s: None)
    with pytest.raises(ErroDaMeta) as erro:
        chamar("/act_9", {"fields": "name"})
    assert erro.value.codigo == "TOKEN_INVALID"
    assert "SEGREDO" not in str(erro.value)
    params = sessao.pedidos[0][1]
    assert params["access_token"] == "SEGREDO" and len(params["appsecret_proof"]) == 64


def test_http_espera_e_repete_no_limite():
    esperas = []
    sessao = SessaoFalsa([Resposta(400, {"error": {"code": 17}}), Resposta(200, {"ok": 1})])
    chamar = chamada_da_meta("t", "s", sessao=sessao, dormir=esperas.append)
    assert chamar("/x", {}) == {"ok": 1}
    assert esperas == [60.0]


def test_sem_token_diz_o_que_fazer():
    with pytest.raises(ErroDaMeta) as erro:
        chamada_da_meta(None, "s")
    assert erro.value.codigo == "AUTH"
