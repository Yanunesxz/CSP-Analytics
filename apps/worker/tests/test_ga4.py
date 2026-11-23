import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from csp_worker.ga4 import ErroDoGa4, Janela, janela_de_releitura, ler_propriedade, pedido

GRAVADAS = Path(__file__).parent / "gravadas"
CONTRATO = Path(__file__).parents[3] / "supabase" / "tests" / "fixtures" / "ga4-eventos.json"
JANELA = Janela(date(2026, 11, 15), date(2026, 11, 16))
AGORA = datetime(2026, 11, 17, 17, 0, tzinfo=UTC)


def gravada(nome):
    return json.loads((GRAVADAS / nome).read_text(encoding="utf-8"))


def api_gravada(chamadas=None):
    def chamar(url, corpo):
        if chamadas is not None:
            chamadas.append((url, corpo))
        return gravada("leads.json" if "dimensionFilter" in corpo else "sessoes.json")

    return chamar


def test_janela_e_de_dias_completos_ate_ontem():
    j = janela_de_releitura(date(2026, 11, 17), 14)
    assert (j.inicio, j.fim) == (date(2026, 11, 3), date(2026, 11, 16))
    assert len(j.dias()) == 14
    with pytest.raises(ValueError):
        janela_de_releitura(date(2026, 11, 17), 0)


def test_pedido_de_sessoes_e_de_leads():
    s = pedido(JANELA, "sessions", 0, so_leads=False)
    assert [d["name"] for d in s["dimensions"]] == [
        "date",
        "sessionSource",
        "sessionMedium",
        "sessionDefaultChannelGroup",
    ]
    assert s["metrics"] == [{"name": "sessions"}]
    assert s["dateRanges"] == [{"startDate": "2026-11-15", "endDate": "2026-11-16"}]
    assert "dimensionFilter" not in s
    lead = pedido(JANELA, "eventCount", 0, so_leads=True)
    assert lead["dimensionFilter"]["filter"]["stringFilter"]["value"] == "generate_lead"


def test_resposta_gravada_vira_o_contrato_da_ingestao():
    """O mesmo arquivo alimenta supabase/tests/conector-ga4.test.ts: o que o adaptador gera, o banco aceita."""
    chamadas = []
    por_dia = ler_propriedade(api_gravada(chamadas), "900000001", "cs", JANELA, AGORA)
    assert chamadas[0][0].endswith("/properties/900000001:runReport")
    assert por_dia == json.loads(CONTRATO.read_text(encoding="utf-8"))


def test_dia_sem_sessao_vem_vazio_para_apagar_o_que_sumiu():
    def vazio(url, corpo):
        return {"rowCount": 0}

    assert ler_propriedade(vazio, "900000001", "cs", JANELA, AGORA) == {"2026-11-15": [], "2026-11-16": []}


def test_pagina_ate_o_fim():
    linha = gravada("sessoes.json")["rows"][0]
    paginas = {0: [linha] * 2, 2: [linha]}
    offsets = []

    def chamar(url, corpo):
        if "dimensionFilter" in corpo:
            return {"rowCount": 0}
        offsets.append(corpo["offset"])
        return {"rows": paginas[corpo["offset"]], "rowCount": 3}

    por_dia = ler_propriedade(chamar, "900000001", "cs", JANELA, AGORA)
    assert offsets == [0, 2]
    assert por_dia["2026-11-15"][0]["values"] == {"sessions": 126, "lead_events": 0}


def test_lead_sem_sessao_na_mesma_chave_entra_com_zero_sessoes():
    def chamar(url, corpo):
        if "dimensionFilter" in corpo:
            return gravada("leads.json")
        return {"rowCount": 0}

    linhas = ler_propriedade(chamar, "900000001", "cs", JANELA, AGORA)["2026-11-15"]
    assert [x["values"] for x in linhas] == [{"sessions": 0, "lead_events": 2}]


def test_formato_inesperado_vira_erro_com_codigo():
    def quebrado(url, corpo):
        return {"rows": [{"dimensionValues": [{"value": "2026-11-15"}], "metricValues": []}], "rowCount": 1}

    with pytest.raises(ErroDoGa4) as erro:
        ler_propriedade(quebrado, "900000001", "cs", JANELA, AGORA)
    assert erro.value.codigo == "GA4_FORMAT"
