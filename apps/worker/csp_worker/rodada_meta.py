"""Os trabalhos da Meta Ads (integracoes.md, seções 2.1 e 4): `ads_hourly` (hoje e ontem) e `ads_backfill`
(os últimos 28 dias, ou desde uma data na primeira carga), uma rodada para todas as contas cadastradas.

Por conta: grava a conta, as campanhas (inclusive apagadas e arquivadas, para a troca do dia não apagar o gasto delas)
e troca cada dia da janela. Uma conta que falha não para as outras: a rodada termina `partial` com o código da
primeira falha. Sem nenhuma conta gravada, termina `failed`. Conta em outra moeda que não o real é recusada pelo banco
(CURRENCY) e o gasto dela não é lido.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Protocol

from .banco import ContaDeAnuncio
from .meta import Chamada, ErroDaMeta, Janela, ler_campanhas, ler_conta, ler_gasto

LIMITE_DO_LOTE = 1000  # o mesmo de private.ingest_batch
log = logging.getLogger("csp_worker.meta")


class BancoDaRodada(Protocol):
    def contas_meta(self) -> list[ContaDeAnuncio]: ...
    def abrir_rodada(self, conector: str, trabalho: str, gatilho: str) -> str: ...
    def gravar(self, rodada: str, funcao: str, linhas: list[dict]) -> list[str]: ...
    def trocar_dia_de_anuncio(self, rodada: str, conta: str, dia: str, linhas: list[dict]) -> list[str]: ...
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


def _lotes(linhas: list[dict]) -> list[list[dict]]:
    return [linhas[i : i + LIMITE_DO_LOTE] for i in range(0, len(linhas), LIMITE_DO_LOTE)] or [[]]


def rodar(banco: BancoDaRodada, chamar: Chamada, janela: Janela, trabalho: str = "ads_backfill") -> Resultado:
    contas = banco.contas_meta()
    if not contas:
        # Sem conta cadastrada não abre rodada: o cartão continua "A ligar", e não "Caído".
        log.info("nenhuma conta da Meta cadastrada; nada a ler")
        return Resultado(status="skipped", codigo="NO_ACCOUNT")

    gatilho = "backfill" if trabalho == "ads_backfill" else "schedule"
    rodada = banco.abrir_rodada("meta", trabalho, gatilho)
    r = Resultado(status="succeeded")
    gravou_alguma = False

    def falhou(conta: ContaDeAnuncio, codigo: str, mensagem: str) -> None:
        r.falhas.append(f"{conta.marca}:{codigo}")
        r.codigo = r.codigo or codigo
        r.mensagem = r.mensagem or f"{conta.marca}: {mensagem}"

    def contar(recusadas: list[str], total: int) -> None:
        r.linhas += total - len(recusadas)
        r.recusadas += len(recusadas)
        if recusadas:
            r.codigo = r.codigo or recusadas[0]

    try:
        for conta in contas:
            try:
                evento_da_conta = ler_conta(chamar, conta.external_id, conta.marca)
                recusadas = banco.gravar(rodada, "upsert_ad_accounts", [evento_da_conta])
                contar(recusadas, 1)
                if recusadas:
                    falhou(conta, recusadas[0], "conta recusada pelo banco; o gasto dela não foi lido")
                    continue
                campanhas = ler_campanhas(chamar, conta.external_id, conta.marca)
                for lote in _lotes(campanhas):
                    contar(banco.gravar(rodada, "upsert_campaigns", lote), len(lote))
                por_dia = ler_gasto(chamar, conta.external_id, conta.marca, janela)
            except ErroDaMeta as erro:
                log.warning("Meta %s (%s): %s", conta.marca, erro.codigo, erro)
                falhou(conta, erro.codigo, str(erro))
                continue
            for dia, linhas in por_dia.items():
                if len(linhas) > LIMITE_DO_LOTE:
                    falhou(conta, "TOO_MANY_ROWS", f"{dia} com mais de {LIMITE_DO_LOTE} linhas")
                    continue
                contar(banco.trocar_dia_de_anuncio(rodada, conta.external_id, dia, linhas), len(linhas))
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
