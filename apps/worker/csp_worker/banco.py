"""Gravação pelas funções `ingest.*`, com o papel `mkt_worker` (integracoes.md, seção 2.3).

O worker nunca escreve em tabela direto: abre a rodada, troca cada dia pela `ingest.replace_day` e fecha a rodada.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Propriedade:
    external_id: str
    marca: str


@dataclass(frozen=True)
class ContaDeAnuncio:
    external_id: str
    marca: str


FUNCOES_DE_GRAVACAO = (
    "upsert_ad_accounts",
    "upsert_campaigns",
    "upsert_brands",
    "upsert_crm_funnels",
    "upsert_sales_reps",
    "upsert_sales_rep_app_logins",
    "upsert_crm_customers",
    "upsert_crm_customer_brands",
    "upsert_crm_customer_reps",
    "upsert_crm_leads",
    "upsert_crm_orders",
    "upsert_crm_upstream_runs",
)


class Banco:
    def __init__(self, conexao):
        self.conexao = conexao
        self.conexao.autocommit = True

    def propriedades_ga4(self) -> list[Propriedade]:
        with self.conexao.cursor() as cur:
            cur.execute(
                """select w.external_id, b.code::text
                     from mkt.web_properties w join mkt.brands b on b.id = w.brand_id
                    where w.kind = 'ga4_property' and w.is_active
                    order by b.code, w.external_id"""
            )
            return [Propriedade(external_id=e, marca=m) for e, m in cur.fetchall()]

    def contas_meta(self) -> list[ContaDeAnuncio]:
        with self.conexao.cursor() as cur:
            cur.execute(
                """select a.external_id, b.code::text
                     from mkt.ad_accounts a join mkt.brands b on b.id = a.brand_id
                    where a.source = 'meta_ads'
                    order by b.code, a.external_id"""
            )
            return [ContaDeAnuncio(external_id=e, marca=m) for e, m in cur.fetchall()]

    def abrir_rodada(self, conector: str = "ga4", trabalho: str = "ga4_daily", gatilho: str = "schedule") -> str:
        with self.conexao.cursor() as cur:
            cur.execute("select ingest.start_run(%s, %s, %s)", (conector, trabalho, gatilho))
            return str(cur.fetchone()[0])

    def gravar(self, rodada: str, funcao: str, linhas: list[dict[str, Any]]) -> list[str]:
        """Grava um lote por `ingest.upsert_<tabela>`. Devolve os códigos das linhas recusadas."""
        if funcao not in FUNCOES_DE_GRAVACAO:
            raise ValueError("função de gravação fora da lista")
        if not linhas:
            return []
        with self.conexao.transaction(), self.conexao.cursor() as cur:
            cur.execute(
                f"select code from ingest.{funcao}(%s, %s::jsonb) where is_refused",
                (rodada, json.dumps(linhas)),
            )
            return [codigo for (codigo,) in cur.fetchall()]

    def trocar_dia_de_anuncio(self, rodada: str, conta: str, dia: str, linhas: list[dict[str, Any]]) -> list[str]:
        with self.conexao.transaction(), self.conexao.cursor() as cur:
            cur.execute(
                "select code from ingest.replace_day(%s, 'ad_campaign_daily', %s, %s, %s::jsonb) where is_refused",
                (rodada, conta, dia, json.dumps(linhas)),
            )
            return [codigo for (codigo,) in cur.fetchall()]

    def trocar_dia(self, rodada: str, propriedade: str, dia: str, linhas: list[dict[str, Any]]) -> list[str]:
        """Grava as linhas do dia numa transação e apaga as que não vieram. Devolve os códigos das recusadas."""
        with self.conexao.transaction(), self.conexao.cursor() as cur:
            cur.execute(
                "select code from ingest.replace_day(%s, 'ga4_traffic_daily', %s, %s, %s::jsonb) where is_refused",
                (rodada, propriedade, dia, json.dumps(linhas)),
            )
            return [codigo for (codigo,) in cur.fetchall()]

    def apagar_o_que_sumiu(self, tabela: str, rodada: str) -> tuple[int, str | None]:
        """Passada completa: `ingest.delete_missing` apaga o que não apareceu (com a trava de 20% no banco)."""
        with self.conexao.transaction(), self.conexao.cursor() as cur:
            cur.execute("select deleted, code from ingest.delete_missing(%s, %s)", (tabela, rodada))
            apagadas, codigo = cur.fetchone()
            return int(apagadas or 0), codigo

    def fechar_rodada(self, rodada: str, status: str, codigo: str | None = None, mensagem: str | None = None) -> None:
        with self.conexao.cursor() as cur:
            cur.execute("select ingest.finish_run(%s, %s, %s, %s)", (rodada, status, codigo, mensagem))
