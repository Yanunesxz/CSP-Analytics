"""Adaptador do GA4 (docs/dados/integracoes.md, seção 9).

O único lugar que conhece o formato da Google Analytics Data API. Lê, por propriedade, as sessões por dia, origem,
meio e canal (`runReport`) e os eventos `generate_lead` com a mesma chave, e devolve os eventos de ingestão do
`ga4_traffic_daily` (seção 2.2), agrupados por dia, para a releitura que troca o dia inteiro (`ingest.replace_day`).

Nada aqui fala com o banco nem guarda credencial: quem chama passa a sessão HTTP já autenticada.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

URL_DA_API = "https://analyticsdata.googleapis.com/v1beta/properties/{propriedade}:runReport"
ESCOPO = "https://www.googleapis.com/auth/analytics.readonly"
DIMENSOES = ("date", "sessionSource", "sessionMedium", "sessionDefaultChannelGroup")
TAMANHO_DA_PAGINA = 10_000
DIAS_DE_RELEITURA = 14  # o GA4 muda o dado por até 12 dias
EVENTO_DE_LEAD = "generate_lead"

# Uma chamada HTTP: recebe a URL e o corpo, devolve o JSON da resposta (ou levanta ErroDoGa4).
Chamada = Callable[[str, dict[str, Any]], dict[str, Any]]


class ErroDoGa4(Exception):
    """Falha da API, com o código curto que vai para `sync_runs.error_code`."""

    def __init__(self, codigo: str, mensagem: str):
        super().__init__(mensagem)
        self.codigo = codigo


@dataclass(frozen=True)
class Janela:
    inicio: date
    fim: date

    def dias(self) -> list[date]:
        return [self.inicio + timedelta(days=n) for n in range((self.fim - self.inicio).days + 1)]


def janela_de_releitura(hoje: date, dias: int = DIAS_DE_RELEITURA) -> Janela:
    """Os `dias` completos até ontem: o dia de hoje ainda muda e nunca troca o que já foi gravado."""
    if dias < 1:
        raise ValueError("dias precisa ser 1 ou mais")
    fim = hoje - timedelta(days=1)
    return Janela(inicio=fim - timedelta(days=dias - 1), fim=fim)


def pedido(janela: Janela, metrica: str, offset: int, so_leads: bool) -> dict[str, Any]:
    corpo: dict[str, Any] = {
        "dateRanges": [{"startDate": janela.inicio.isoformat(), "endDate": janela.fim.isoformat()}],
        "dimensions": [{"name": d} for d in DIMENSOES],
        "metrics": [{"name": metrica}],
        "limit": TAMANHO_DA_PAGINA,
        "offset": offset,
        "keepEmptyRows": False,
        "returnPropertyQuota": True,
    }
    if so_leads:
        corpo["dimensionFilter"] = {
            "filter": {"fieldName": "eventName", "stringFilter": {"matchType": "EXACT", "value": EVENTO_DE_LEAD}}
        }
    return corpo


def _linhas(chamar: Chamada, propriedade: str, janela: Janela, metrica: str, so_leads: bool) -> Iterable[dict]:
    url = URL_DA_API.format(propriedade=propriedade)
    offset = 0
    while True:
        resposta = chamar(url, pedido(janela, metrica, offset, so_leads))
        linhas = resposta.get("rows") or []
        yield from linhas
        offset += len(linhas)
        if not linhas or offset >= int(resposta.get("rowCount") or 0):
            return


def _chave(linha: dict) -> tuple[str, str, str, str]:
    valores = [d.get("value", "") for d in linha.get("dimensionValues", [])]
    if len(valores) != len(DIMENSOES):
        raise ErroDoGa4("GA4_FORMAT", "linha do GA4 com dimensões fora do pedido")
    dia, origem, meio, canal = valores
    if len(dia) != 8 or not dia.isdigit():
        raise ErroDoGa4("GA4_FORMAT", "data do GA4 fora do formato AAAAMMDD")
    return f"{dia[:4]}-{dia[4:6]}-{dia[6:]}", origem, meio, canal


def _inteiro(linha: dict) -> int:
    try:
        return int(linha["metricValues"][0]["value"])
    except (KeyError, IndexError, ValueError) as erro:
        raise ErroDoGa4("GA4_FORMAT", "métrica do GA4 fora do formato") from erro


def ler_propriedade(
    chamar: Chamada, propriedade: str, marca: str, janela: Janela, agora: datetime | None = None
) -> dict[str, list[dict[str, Any]]]:
    """Os eventos de ingestão da propriedade, por dia (`AAAA-MM-DD`). Todo dia da janela aparece, mesmo vazio:
    a lista vazia apaga o que o dia tinha e não veio mais."""
    lido_em = (agora or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")
    sessoes: dict[tuple[str, str, str, str], int] = {}
    for linha in _linhas(chamar, propriedade, janela, "sessions", so_leads=False):
        chave = _chave(linha)
        sessoes[chave] = sessoes.get(chave, 0) + _inteiro(linha)
    leads: dict[tuple[str, str, str, str], int] = {}
    for linha in _linhas(chamar, propriedade, janela, "eventCount", so_leads=True):
        chave = _chave(linha)
        leads[chave] = leads.get(chave, 0) + _inteiro(linha)

    por_dia: dict[str, list[dict[str, Any]]] = {d.isoformat(): [] for d in janela.dias()}
    for chave in sorted(sessoes.keys() | leads.keys()):
        dia, origem, meio, canal = chave
        if dia not in por_dia:
            continue  # o GA4 não devolve fora da janela; se devolver, não troca dia que não foi pedido
        por_dia[dia].append(
            {
                "kind": "ga4_traffic_daily",
                "source": "ga4",
                "brand": marca,
                "key": {
                    "property_external_id": propriedade,
                    "metric_on": dia,
                    "session_source": origem,
                    "session_medium": meio,
                    "channel_group_raw": canal,
                },
                "values": {"sessions": sessoes.get(chave, 0), "lead_events": leads.get(chave, 0)},
                "fetched_at": lido_em,
            }
        )
    return por_dia
