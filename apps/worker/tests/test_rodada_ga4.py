from datetime import date

import pytest

from csp_worker.banco import Propriedade
from csp_worker.ga4 import ErroDoGa4
from csp_worker.rodada_ga4 import rodar


class BancoFalso:
    def __init__(self, propriedades, recusar=()):
        self.propriedades = propriedades
        self.recusar = list(recusar)
        self.trocas = []
        self.fechada = None
        self.abertas = 0

    def propriedades_ga4(self):
        return self.propriedades

    def abrir_rodada(self):
        self.abertas += 1
        return "rodada-1"

    def trocar_dia(self, rodada, propriedade, dia, linhas):
        self.trocas.append((propriedade, dia, len(linhas)))
        return self.recusar.pop(0) if self.recusar else []

    def fechar_rodada(self, rodada, status, codigo=None, mensagem=None):
        self.fechada = (status, codigo, mensagem)


def linha(dia):
    return {
        "rows": [
            {
                "dimensionValues": [
                    {"value": dia},
                    {"value": "google"},
                    {"value": "organic"},
                    {"value": "Organic Search"},
                ],
                "metricValues": [{"value": "5"}],
            }
        ],
        "rowCount": 1,
    }


def api(url, corpo):
    if "dimensionFilter" in corpo:
        return {"rowCount": 0}
    return linha(corpo["dateRanges"][0]["endDate"].replace("-", ""))


HOJE = date(2026, 11, 17)


def test_sem_propriedade_nao_abre_rodada():
    banco = BancoFalso([])
    r = rodar(banco, api, HOJE, 3)
    assert (r.status, r.codigo, banco.abertas) == ("skipped", "NO_PROPERTY", 0)


def test_troca_cada_dia_de_cada_propriedade():
    banco = BancoFalso([Propriedade("900000001", "cs"), Propriedade("900000002", "plumene")])
    r = rodar(banco, api, HOJE, 3)
    assert r.status == "succeeded"
    assert [t[:2] for t in banco.trocas] == [
        ("900000001", "2026-11-14"),
        ("900000001", "2026-11-15"),
        ("900000001", "2026-11-16"),
        ("900000002", "2026-11-14"),
        ("900000002", "2026-11-15"),
        ("900000002", "2026-11-16"),
    ]
    assert banco.fechada == ("succeeded", None, None)


def test_propriedade_sem_permissao_deixa_a_rodada_parcial():
    def api_sem_plumene(url, corpo):
        if "900000002" in url:
            raise ErroDoGa4("PERMISSION", "o GA4 recusou a conta de serviço")
        return api(url, corpo)

    banco = BancoFalso([Propriedade("900000001", "cs"), Propriedade("900000002", "plumene")])
    r = rodar(banco, api_sem_plumene, HOJE, 2)
    assert r.status == "partial"
    assert banco.fechada[:2] == ("partial", "PERMISSION")
    assert {t[0] for t in banco.trocas} == {"900000001"}


def test_nenhuma_propriedade_lida_falha_a_rodada():
    def sempre_falha(url, corpo):
        raise ErroDoGa4("PERMISSION", "recusou")

    banco = BancoFalso([Propriedade("900000001", "cs")])
    assert rodar(banco, sempre_falha, HOJE, 2).status == "failed"
    assert banco.fechada[0] == "failed"


def test_linha_recusada_pelo_banco_deixa_parcial_com_o_codigo():
    banco = BancoFalso([Propriedade("900000001", "cs")], recusar=[["PERSONAL_DATA_DROPPED"]])
    r = rodar(banco, api, HOJE, 2)
    assert (r.status, r.codigo, r.recusadas) == ("partial", "PERSONAL_DATA_DROPPED", 1)


def test_erro_do_banco_fecha_a_rodada_como_falha_e_repassa():
    class Quebrado(BancoFalso):
        def trocar_dia(self, *a):
            raise RuntimeError("conexão caiu")

    banco = Quebrado([Propriedade("900000001", "cs")])
    with pytest.raises(RuntimeError):
        rodar(banco, api, HOJE, 2)
    assert banco.fechada == ("failed", "WORKER", "RuntimeError")
