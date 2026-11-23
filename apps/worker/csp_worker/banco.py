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

    def abrir_rodada(self) -> str:
        with self.conexao.cursor() as cur:
            cur.execute("select ingest.start_run('ga4', 'ga4_daily', 'schedule')")
            return str(cur.fetchone()[0])

    def trocar_dia(self, rodada: str, propriedade: str, dia: str, linhas: list[dict[str, Any]]) -> list[str]:
        """Grava as linhas do dia numa transação e apaga as que não vieram. Devolve os códigos das recusadas."""
        with self.conexao.transaction(), self.conexao.cursor() as cur:
            cur.execute(
                "select code from ingest.replace_day(%s, 'ga4_traffic_daily', %s, %s, %s::jsonb) where is_refused",
                (rodada, propriedade, dia, json.dumps(linhas)),
            )
            return [codigo for (codigo,) in cur.fetchall()]

    def fechar_rodada(self, rodada: str, status: str, codigo: str | None = None, mensagem: str | None = None) -> None:
        with self.conexao.cursor() as cur:
            cur.execute("select ingest.finish_run(%s, %s, %s, %s)", (rodada, status, codigo, mensagem))
