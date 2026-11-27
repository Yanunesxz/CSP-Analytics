"""Os trabalhos do CSP 360 (integracoes.md, seção 3.4): `crm_incremental` (a cada 5 min, a janela de 3 dias) e
`crm_full_pass` (uma vez por dia, tudo, apagando o que sumiu do CRM).

Ordem na rodada: marcas → funis → representantes → clientes e as views deles → leads → pedidos com itens → rodadas
apps → CRM. Antes de ler, confere as 12 views com a lista exata de colunas (SCHEMA_DRIFT). Na passada completa,
`clientes`, `pedidos` ou `negocios` vazios terminam a rodada `failed` com EMPTY_SOURCE, sem apagar nada.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Protocol

from .crm import Conversor
from .crm_http import PAGINA, Chamada, ErroDoCrm, colunas, conferir_views, por_chave, por_ids

LIMITE_DO_LOTE = 1000  # o mesmo de private.ingest_batch
DIAS_DA_JANELA = 3
# Ordem da exclusão na passada completa: do que depende para o que é dependido.
TABELAS_DA_PASSADA = (
    "crm_orders",
    "crm_leads",
    "crm_customer_reps",
    "crm_customer_brands",
    "crm_customers",
    "sales_rep_app_logins",
    "sales_reps",
    "crm_funnels",
)
log = logging.getLogger("csp_worker.crm")


class BancoDaRodada(Protocol):
    def abrir_rodada(self, conector: str, trabalho: str, gatilho: str) -> str: ...
    def gravar(self, rodada: str, funcao: str, linhas: list[dict]) -> list[str]: ...
    def apagar_o_que_sumiu(self, tabela: str, rodada: str) -> tuple[int, str | None]: ...
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
    apagadas: int = 0
    lidas: dict[str, int] = field(default_factory=dict)


def inicio_da_janela(hoje_utc: date, dias: int = DIAS_DA_JANELA) -> str:
    """Hoje e os dois dias anteriores, em UTC, a partir da meia-noite (decisão 0041, item 4)."""
    return f"{(hoje_utc - timedelta(days=dias - 1)).isoformat()}T00:00:00Z"


def rodar(banco: BancoDaRodada, chamar: Chamada, conversor: Conversor, completa: bool, hoje_utc: date) -> Resultado:
    trabalho = "crm_full_pass" if completa else "crm_incremental"
    rodada = banco.abrir_rodada("csp360", trabalho, "schedule")
    r = Resultado(status="succeeded")

    def gravar(funcao: str, eventos: list[dict]) -> None:
        for i in range(0, len(eventos), LIMITE_DO_LOTE):
            lote = eventos[i : i + LIMITE_DO_LOTE]
            recusadas = banco.gravar(rodada, funcao, lote)
            r.linhas += len(lote) - len(recusadas)
            r.recusadas += len(recusadas)
            if recusadas:
                r.codigo = r.codigo or recusadas[0]

    try:
        try:
            conferir_views(chamar)
            _ler_e_gravar(chamar, conversor, completa, hoje_utc, gravar, r)
        except ErroDoCrm as erro:
            log.warning("CSP 360 (%s): %s", erro.codigo, erro)
            r.status, r.codigo, r.mensagem = "failed", erro.codigo, str(erro)
            banco.fechar_rodada(rodada, "failed", erro.codigo, str(erro))
            return r

        if completa:
            for tabela in TABELAS_DA_PASSADA:
                apagadas, codigo = banco.apagar_o_que_sumiu(tabela, rodada)
                r.apagadas += apagadas
                if codigo:
                    log.warning("passada completa: %s em %s, nada apagado nela", codigo, tabela)
                    r.codigo = codigo
                    r.mensagem = f"{tabela}: exclusão em massa segurada; confira e confirme na tela de Conectores"
    except Exception as erro:  # falha do banco ou inesperada: fecha a rodada antes de sair
        banco.fechar_rodada(rodada, "failed", "WORKER", type(erro).__name__)
        raise

    if r.recusadas or r.codigo == "MASS_DELETE_BLOCKED":
        r.status = "partial"
    banco.fechar_rodada(rodada, r.status, r.codigo if r.status != "succeeded" else None, r.mensagem)
    return r


def _ler_e_gravar(chamar: Chamada, conv: Conversor, completa: bool, hoje_utc: date, gravar, r: Resultado) -> None:
    def contar(view: str, linhas: list) -> list:
        r.lidas[view] = r.lidas.get(view, 0) + len(linhas)
        return linhas

    # Marcas, funis e usuários são poucos: vêm inteiros nas duas rodadas (o lead precisa do funil e do responsável).
    gravar("upsert_brands", conv.marcas(contar("marcas", list(por_chave(chamar, "marcas")))))
    gravar("upsert_crm_funnels", [conv.funil(f) for f in contar("funis_venda", list(por_chave(chamar, "funis_venda")))])
    reps, logins = [], []
    for u in contar("usuarios", list(por_chave(chamar, "usuarios"))):
        rep, ls = conv.usuario(u)
        reps.append(rep)
        logins.extend(ls)
    gravar("upsert_sales_reps", reps)
    gravar("upsert_sales_rep_app_logins", logins)

    # Leads e pedidos: tudo na passada completa; na de 5 min, a janela de 3 dias pelo carimbo.
    if completa:
        negocios = list(por_chave(chamar, "negocios"))
        sdr = list(por_chave(chamar, "leads_sdr"))
        pedidos = list(por_chave(chamar, "pedidos"))
    else:
        desde = inicio_da_janela(hoje_utc)
        negocios = list(por_chave(chamar, "negocios", filtros={"atualizado_em": f"gte.{desde}"}))
        sdr = list(por_chave(chamar, "leads_sdr", filtros={"atualizado_em": f"gte.{desde}"}))
        # No pedido sem carimbo vale criado_em.
        pedidos = list(
            por_chave(
                chamar,
                "pedidos",
                filtros={"or": f"(atualizado_em.gte.{desde},and(atualizado_em.is.null,criado_em.gte.{desde}))"},
            )
        )
    contar("negocios", negocios)
    contar("leads_sdr", sdr)
    contar("pedidos", pedidos)

    # Clientes: todos na passada completa; na de 5 min, só os citados pelas linhas lidas, sempre relidos.
    if completa:
        clientes = list(por_chave(chamar, "clientes"))
        utms = list(por_chave(chamar, "clientes_utm", chave="cliente_id"))
        compras = _compras_todas(chamar)
        responsaveis = list(por_chave(chamar, "negocios_responsavel", chave="negocio_id"))
        vazias = [
            v for v, linhas in (("clientes", clientes), ("pedidos", pedidos), ("negocios", negocios)) if not linhas
        ]
        if vazias:
            raise ErroDoCrm("EMPTY_SOURCE", f"{', '.join(vazias)} voltou vazio na passada completa; nada foi apagado")
    else:
        citados = sorted({str(x["cliente_id"]) for x in (*negocios, *sdr, *pedidos) if x.get("cliente_id") is not None})
        clientes = list(por_ids(chamar, "clientes", "id", citados))
        utms = list(por_ids(chamar, "clientes_utm", "cliente_id", citados))
        compras = list(por_ids(chamar, "clientes_compras_marca", "cliente_id", citados))
        responsaveis = list(por_ids(chamar, "negocios_responsavel", "negocio_id", [str(n["id"]) for n in negocios]))
    contar("clientes", clientes)
    contar("clientes_utm", utms)
    contar("clientes_compras_marca", compras)
    contar("negocios_responsavel", responsaveis)

    utm_do_cliente = {str(u["cliente_id"]): u for u in utms}
    eventos_clientes, carteira = [], []
    for c in clientes:
        cliente, donos = conv.cliente(c, utm_do_cliente.get(str(c["id"])))
        eventos_clientes.append(cliente)
        carteira.extend(donos)
    gravar("upsert_crm_customers", eventos_clientes)
    gravar("upsert_crm_customer_brands", [e for e in (conv.compra_por_marca(x) for x in compras) if e is not None])
    gravar("upsert_crm_customer_reps", carteira)

    responsavel_do_negocio = {str(x["negocio_id"]): str(x["responsavel_id"]) for x in responsaveis}
    leads = [conv.negocio(n, responsavel_do_negocio.get(str(n["id"]))) for n in negocios]
    leads.extend(conv.lead_sdr(s) for s in sdr)
    gravar("upsert_crm_leads", leads)

    itens_do_pedido: dict[str, list[dict]] = {}
    for item in contar(
        "pedido_itens", list(por_ids(chamar, "pedido_itens", "pedido_id", [str(p["id"]) for p in pedidos]))
    ):
        itens_do_pedido.setdefault(str(item["pedido_id"]), []).append(item)
    gravar(
        "upsert_crm_orders",
        [e for e in (conv.pedido(p, itens_do_pedido.get(str(p["id"]), [])) for p in pedidos) if e is not None],
    )

    sincronizacoes = contar(
        "sincronizacoes",
        chamar("sincronizacoes", {"select": colunas("sincronizacoes"), "order": "iniciada_em.desc", "limit": "20"}),
    )
    gravar("upsert_crm_upstream_runs", [e for e in (conv.sincronizacao(s) for s in sincronizacoes) if e is not None])


def _compras_todas(chamar: Chamada) -> list[dict]:
    """clientes_compras_marca tem uma linha por cliente e marca: a chave é o par, em ordem."""
    linhas: list[dict] = []
    ultima: tuple[str, str] | None = None
    while True:
        parametros = {
            "select": colunas("clientes_compras_marca"),
            "order": "cliente_id.asc,marca_id.asc",
            "limit": str(PAGINA),
        }
        if ultima is not None:
            c, m = ultima
            parametros["or"] = f"(cliente_id.gt.{c},and(cliente_id.eq.{c},marca_id.gt.{m}))"
        pagina = chamar("clientes_compras_marca", parametros)
        linhas.extend(pagina)
        if len(pagina) < PAGINA:
            return linhas
        ultima = (str(pagina[-1]["cliente_id"]), str(pagina[-1]["marca_id"]))
