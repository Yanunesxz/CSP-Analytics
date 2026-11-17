"""O trabalho `ga4_daily` (integracoes.md, seções 2.1 e 9): uma rodada para todas as propriedades do GA4.

Cada propriedade relê os últimos 14 dias completos e troca dia por dia. Uma propriedade que falha não para as
outras: a rodada termina `partial` com o código da primeira falha. Sem nenhuma gravada, termina `failed`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Protocol

from .banco import Propriedade
from .ga4 import Chamada, ErroDoGa4, janela_de_releitura, ler_propriedade

LIMITE_DO_LOTE = 1000  # o mesmo de private.ingest_batch
log = logging.getLogger("csp_worker.ga4")


class BancoDaRodada(Protocol):
    def propriedades_ga4(self) -> list[Propriedade]: ...
    def abrir_rodada(self) -> str: ...
    def trocar_dia(self, rodada: str, propriedade: str, dia: str, linhas: list[dict]) -> list[str]: ...
    def fechar_rodada(
        self, rodada: str, status: str, codigo: str | None = None, mensagem: str | None = None
    ) -> None: ...


@dataclass
class Resultado:
    status: str
    codigo: str | None = None
    mensagem: str | None = None
    linhas: int = 0
    recusadas: int = 0
    falhas: list[str] = field(default_factory=list)


def rodar(banco: BancoDaRodada, chamar: Chamada, hoje: date, dias: int = 14) -> Resultado:
    propriedades = banco.propriedades_ga4()
    if not propriedades:
        # Sem propriedade cadastrada não abre rodada: o cartão continua "A ligar", e não "Caído".
        log.info("nenhuma propriedade do GA4 cadastrada; nada a ler")
        return Resultado(status="skipped", codigo="NO_PROPERTY")

    janela = janela_de_releitura(hoje, dias)
    rodada = banco.abrir_rodada()
    r = Resultado(status="succeeded")
    gravou_alguma = False
    try:
        for p in propriedades:
            try:
                por_dia = ler_propriedade(chamar, p.external_id, p.marca, janela)
            except ErroDoGa4 as erro:
                log.warning("GA4 %s (%s): %s", p.marca, erro.codigo, erro)
                r.falhas.append(f"{p.marca}:{erro.codigo}")
                r.codigo = r.codigo or erro.codigo
                r.mensagem = r.mensagem or f"{p.marca}: {erro}"
                continue
            for dia, linhas in por_dia.items():
                if len(linhas) > LIMITE_DO_LOTE:
                    r.falhas.append(f"{p.marca}:{dia}:TOO_MANY_ROWS")
                    r.codigo = r.codigo or "TOO_MANY_ROWS"
                    r.mensagem = r.mensagem or f"{p.marca}: {dia} com mais de {LIMITE_DO_LOTE} linhas"
                    continue
                recusadas = banco.trocar_dia(rodada, p.external_id, dia, linhas)
                r.linhas += len(linhas) - len(recusadas)
                r.recusadas += len(recusadas)
                if recusadas:
                    r.codigo = r.codigo or recusadas[0]
            gravou_alguma = True
    except Exception as erro:  # falha do banco ou inesperada: fecha a rodada antes de sair
        banco.fechar_rodada(rodada, "failed", "WORKER", type(erro).__name__)
        raise

    if r.falhas and not gravou_alguma:
        r.status = "failed"
    elif r.falhas or r.recusadas:
        r.status = "partial"
    banco.fechar_rodada(rodada, r.status, r.codigo if r.status != "succeeded" else None, r.mensagem)
    return r
