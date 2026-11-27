"""Adaptador da Meta Ads (docs/dados/integracoes.md, seção 4).

O único lugar que conhece o formato da Marketing API. Por conta cadastrada, lê a conta (nome, moeda, fuso, teto),
as campanhas (inclusive apagadas e arquivadas) e o gasto por campanha e dia (`/insights`, `level=campaign`,
`time_increment=1`), e devolve os eventos de ingestão (seção 2.2): `ad_account`, `campaign` e `ad_campaign_daily`,
este agrupado por dia para a releitura que troca o dia inteiro.

Nada aqui fala com o banco nem guarda o token: quem chama passa a `Chamada` já autenticada (meta_http.py).
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

VERSAO = "v26.0"
URL_BASE = f"https://graph.facebook.com/{VERSAO}"
log = logging.getLogger("csp_worker.meta")
DIAS_DE_RELEITURA = 28  # depois de 28 dias a Meta não muda o número
TAMANHO_DA_PAGINA = 500
STATUS_LIDOS = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"]

# action_type de cada coluna (a confirmar na primeira leitura; integracoes.md, seção 4).
ACOES_DE_LEAD = {"lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"}
ACOES_DE_CONVERSAO = {
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "complete_registration",
    "offsite_conversion.fb_pixel_complete_registration",
}
ACOES_DE_VALOR = {"purchase", "offsite_conversion.fb_pixel_purchase"}

STATUS_DA_CAMPANHA = {
    "ACTIVE": "active",
    "IN_PROCESS": "active",
    "WITH_ISSUES": "active",
    "PAUSED": "paused",
    "CAMPAIGN_PAUSED": "paused",
    "ADSET_PAUSED": "paused",
    "ARCHIVED": "ended",
    "DELETED": "ended",
}

# Uma chamada GET: recebe o caminho (ou a URL de paginação) e os parâmetros, devolve o JSON (ou levanta ErroDaMeta).
Chamada = Callable[[str, dict[str, Any]], dict[str, Any]]


class ErroDaMeta(Exception):
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
    """Os `dias` até hoje, inclusive: o gasto de hoje entra e é trocado na próxima rodada."""
    if dias < 1:
        raise ValueError("dias precisa ser 1 ou mais")
    return Janela(inicio=hoje - timedelta(days=dias - 1), fim=hoje)


def id_da_conta(external_id: str) -> str:
    """A conta como a API pede (`act_<número>`), aceitando o cadastro com ou sem o prefixo."""
    numero = external_id.strip().removeprefix("act_")
    if not numero.isdigit():
        raise ErroDaMeta("ACCOUNT", "conta da Meta cadastrada fora do formato act_<número>")
    return f"act_{numero}"


def centavos(valor: Any) -> int:
    """Reais em texto (como a Meta manda o gasto) para centavos, sem ponto flutuante; meio centavo para cima."""
    if valor in (None, ""):
        return 0
    try:
        return int((Decimal(str(valor)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except InvalidOperation as erro:
        raise ErroDaMeta("META_API", "valor em dinheiro fora do formato") from erro


def _soma_de_acoes(acoes: list[dict] | None, tipos: set[str]) -> Decimal:
    total = Decimal(0)
    for a in acoes or []:
        if a.get("action_type") in tipos:
            try:
                total += Decimal(str(a.get("value") or 0))
            except InvalidOperation:
                continue
    return total


def _paginas(chamar: Chamada, caminho: str, parametros: dict[str, Any]) -> Iterable[dict]:
    resposta = chamar(caminho, parametros)
    while True:
        yield from resposta.get("data") or []
        proxima = (resposta.get("paging") or {}).get("next")
        if not proxima:
            return
        resposta = chamar(proxima, {})


def _agora() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def ler_conta(chamar: Chamada, external_id: str, marca: str) -> dict:
    c = chamar(
        f"/{id_da_conta(external_id)}",
        {"fields": "name,currency,timezone_name,account_status,spend_cap,amount_spent"},
    )
    return {
        "kind": "ad_account",
        "source": "meta_ads",
        "brand": marca,
        "key": {"external_id": external_id},
        "values": {
            "name": c.get("name"),
            "currency": c.get("currency"),
            "time_zone": c.get("timezone_name"),
            "is_active": c.get("account_status") == 1,
            # spend_cap e amount_spent chegam em centavos, em texto; 0 no teto quer dizer sem teto (o banco grava nulo)
            "spend_cap_cents": int(c.get("spend_cap") or 0),
            "amount_spent_cents": int(c.get("amount_spent") or 0),
        },
        "fetched_at": _agora(),
    }


def _com_e_sem_filtro(chamar: Chamada, caminho: str, parametros: dict[str, Any], filtro: str) -> list[dict]:
    """Lê com o filtro de status (para trazer apagadas e arquivadas); se a Meta recusar o pedido (BAD_REQUEST), lê de
    novo sem ele. Sem o filtro vêm só as que não foram apagadas nem arquivadas; o gasto das outras ainda entra, porque a
    rodada cria a campanha que aparece no gasto e não veio na lista (`campanhas_que_faltam`)."""
    try:
        return list(_paginas(chamar, caminho, parametros))
    except ErroDaMeta as erro:
        if erro.codigo != "BAD_REQUEST":
            raise
        log.warning("Meta recusou o filtro %s (%s); lendo sem ele", filtro, erro)
        return list(_paginas(chamar, caminho, {k: v for k, v in parametros.items() if k != filtro}))


def ler_campanhas(chamar: Chamada, external_id: str, marca: str) -> list[dict]:
    conta = id_da_conta(external_id)
    eventos = []
    agora = _agora()
    for c in _com_e_sem_filtro(
        chamar,
        f"/{conta}/campaigns",
        {
            "fields": "id,name,effective_status,daily_budget,spend_cap,created_time",
            # DELETED não vale aqui: a Meta recusa o pedido inteiro ("objetos excluídos não são aceitos neste
            # endpoint", 100/1815001, 27/11). A campanha apagada que teve gasto entra pelo `campanhas_que_faltam`.
            "effective_status": str([s for s in STATUS_LIDOS if s != "DELETED"]).replace("'", '"'),
            "limit": TAMANHO_DA_PAGINA,
        },
        "effective_status",
    ):
        status = STATUS_DA_CAMPANHA.get(str(c.get("effective_status")), "paused")
        valores: dict[str, Any] = {
            "account_external_id": external_id,
            "name": c.get("name"),
            "status": status,
            # orçamento já vem em centavos; sem orçamento na campanha (fica nos conjuntos) → nulo
            "daily_budget_cents": int(c["daily_budget"]) if c.get("daily_budget") else None,
            "spend_cap_cents": int(c["spend_cap"]) if c.get("spend_cap") else None,
        }
        if c.get("created_time"):
            valores["source_created_at"] = c["created_time"]
        eventos.append(
            {
                "kind": "campaign",
                "source": "meta_ads",
                "brand": marca,
                "key": {"external_id": str(c["id"])},
                "values": valores,
                "fetched_at": agora,
            }
        )
    return eventos


def ler_gasto(
    chamar: Chamada, external_id: str, marca: str, janela: Janela, nomes: dict[str, str] | None = None
) -> dict[str, list[dict]]:
    """O gasto por campanha e dia, agrupado por dia. Todo dia da janela aparece (vazio = sem gasto no dia).
    Em `nomes`, se vier, guarda o nome de cada campanha que teve linha, para a rodada criar a que faltar."""
    conta = id_da_conta(external_id)
    por_dia: dict[str, list[dict]] = {d.isoformat(): [] for d in janela.dias()}
    agora = _agora()
    filtro = [{"field": "campaign.effective_status", "operator": "IN", "value": STATUS_LIDOS}]
    for linha in _com_e_sem_filtro(
        chamar,
        f"/{conta}/insights",
        {
            "level": "campaign",
            "time_increment": 1,
            "time_range": f'{{"since":"{janela.inicio.isoformat()}","until":"{janela.fim.isoformat()}"}}',
            "filtering": str(filtro).replace("'", '"'),
            "use_unified_attribution_setting": "true",
            "fields": "campaign_id,campaign_name,date_start,spend,impressions,inline_link_clicks,actions,action_values",
            "limit": TAMANHO_DA_PAGINA,
        },
        "filtering",
    ):
        if nomes is not None and linha.get("campaign_id"):
            nomes[str(linha["campaign_id"])] = str(linha.get("campaign_name") or "")
        dia = str(linha.get("date_start"))
        if dia not in por_dia:
            continue
        valor = _soma_de_acoes(linha.get("action_values"), ACOES_DE_VALOR)
        por_dia[dia].append(
            {
                "kind": "ad_campaign_daily",
                "source": "meta_ads",
                "brand": marca,
                "key": {"campaign_external_id": str(linha["campaign_id"]), "metric_on": dia},
                "values": {
                    "spend_cents": centavos(linha.get("spend")),
                    "impressions": int(linha.get("impressions") or 0),
                    "clicks": int(linha.get("inline_link_clicks") or 0),
                    "platform_leads": int(_soma_de_acoes(linha.get("actions"), ACOES_DE_LEAD)),
                    "conversions": str(_soma_de_acoes(linha.get("actions"), ACOES_DE_CONVERSAO)),
                    "conversion_value_cents": centavos(valor),
                },
                "fetched_at": agora,
            }
        )
    return por_dia


def campanhas_que_faltam(external_id: str, marca: str, conhecidas: set[str], nomes: dict[str, str]) -> list[dict]:
    """Campanha que aparece no gasto e não veio na lista (apagada ou arquivada, lida sem o filtro): entra encerrada,
    para o gasto dela não ser recusado."""
    agora = _agora()
    return [
        {
            "kind": "campaign",
            "source": "meta_ads",
            "brand": marca,
            "key": {"external_id": cid},
            "values": {"account_external_id": external_id, "name": nome or f"Campanha {cid}", "status": "ended"},
            "fetched_at": agora,
        }
        for cid, nome in sorted(nomes.items())
        if cid not in conhecidas
    ]
