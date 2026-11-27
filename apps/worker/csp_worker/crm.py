"""Adaptador do CSP 360: converte as linhas das views do CRM nos eventos que as funções `ingest.upsert_crm_*` aceitam
(integracoes.md, seções 3.2 e 3.5). Funções puras, sem rede e sem banco.

Nunca sai daqui nome, contato, documento ou o login de app em claro: o login vira resumo HMAC-SHA256 com
REP_LOGIN_HMAC_KEY antes de qualquer gravação e nunca vai para log.
"""

from __future__ import annotations

import hashlib
import hmac
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

FONTE = "csp360"
MARCA_DA_SIGLA = {"CS": "cs", "PL": "plumene"}
STATUS_DO_CLIENTE = {"prospecto": "prospect", "ativo": "active", "inativo": "inactive"}
# usuarios.papel do CRM → mkt.rep_crm_role; papel fora da lista entra nulo (decisão 0041, item 8).
PAPEL_DO_USUARIO = {
    "gestor": "manager",
    "supervisor": "supervisor",
    "vendedor-interno": "internal_seller",
    "representante": "field_rep",
    "atendimento": "customer_service",
}
DISPAROS = {"cron", "manual", "script"}


def evento(tipo: str, chave: dict[str, Any], valores: dict[str, Any], marca: str | None = None) -> dict[str, Any]:
    e: dict[str, Any] = {"kind": tipo, "source": FONTE, "key": chave, "values": valores}
    if marca is not None:
        e["brand"] = marca
    return e


def centavos(valor: Any) -> int | None:
    """Reais (número ou texto com ponto) em centavos, em decimal, meio centavo para cima. Fora do formato: nulo."""
    if valor is None or isinstance(valor, bool):
        return None
    try:
        d = Decimal(str(valor))
    except (InvalidOperation, ValueError):
        return None
    if not d.is_finite():
        return None
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def resumo_do_login(chave_hmac: bytes, login: Any) -> tuple[str, str] | None:
    """`<id da marca no CRM>:<id do usuário no app>` → (id da marca no CRM, resumo HMAC). Vazio, ou só a marca sem id,
    quer dizer sem login: nulo."""
    if not isinstance(login, str):
        return None
    login = login.strip()
    marca, sep, usuario = login.partition(":")
    if not sep or not marca.strip() or not usuario.strip():
        return None
    return marca.strip(), hmac.new(chave_hmac, login.encode(), hashlib.sha256).hexdigest()


class Conversor:
    """Guarda o de-para das marcas do CRM (id → código daqui) lido na rodada."""

    def __init__(self, chave_hmac: bytes):
        if not chave_hmac:
            raise ValueError("chave HMAC vazia")
        self.chave_hmac = chave_hmac
        self.marca_do_id: dict[str, str] = {}

    # ---------- marcas e funis ----------

    def marcas(self, linhas: list[dict]) -> list[dict]:
        eventos = []
        for m in linhas:
            codigo = MARCA_DA_SIGLA.get(str(m.get("sigla") or "").strip().upper())
            if codigo is None:
                continue
            self.marca_do_id[str(m["id"])] = codigo
            eventos.append(evento("brand", {"external_id": str(m["id"])}, {"name": m.get("nome_fantasia")}, codigo))
        return eventos

    def marca(self, marca_id: Any) -> str | None:
        return self.marca_do_id.get(str(marca_id)) if marca_id is not None else None

    @staticmethod
    def funil(f: dict) -> dict:
        return evento(
            "crm_funnel", {"external_id": str(f["id"])}, {"name": f.get("nome"), "is_default": bool(f.get("padrao"))}
        )

    # ---------- usuários e logins de app ----------

    def usuario(self, u: dict) -> tuple[dict, list[dict]]:
        rep = evento(
            "sales_rep",
            {"external_id": str(u["id"])},
            {"crm_role": PAPEL_DO_USUARIO.get(str(u.get("papel") or "")), "is_active": u.get("ativo") is not False},
        )
        logins = []
        for marca_crm, resumo in self._logins(u.get("logins_app")):
            marca = self.marca(marca_crm)
            if marca is not None:
                logins.append(
                    evento(
                        "sales_rep_app_login",
                        {"app_login_key": resumo},
                        {"sales_rep_external_id": str(u["id"])},
                        marca,
                    )
                )
        return rep, logins

    def _logins(self, lista: Any) -> list[tuple[str, str]]:
        if isinstance(lista, str):
            lista = [lista]
        if not isinstance(lista, list):
            return []
        saida = []
        for login in lista:
            r = resumo_do_login(self.chave_hmac, login)
            if r is not None and r not in saida:
                saida.append(r)
        return saida

    # ---------- clientes ----------

    def cliente(self, c: dict, utm: dict | None) -> tuple[dict, list[dict]]:
        utm = utm or {}
        donos = self._logins(c.get("donos_app"))
        cliente = evento(
            "crm_customer",
            {"external_id": str(c["id"])},
            {
                "code": c.get("codigo"),
                "crm_status": STATUS_DO_CLIENTE.get(str(c.get("status") or "")),
                "is_known_by_erp": c.get("retrato_carregado") is True,
                "has_app_owner": bool(donos),
                "first_utm_source": utm.get("utm_source"),
                "first_utm_medium": utm.get("utm_medium"),
                "first_utm_campaign": utm.get("utm_campaign"),
                "source_created_at": c.get("criado_em"),
            },
        )
        carteira = []
        for marca_crm, resumo in donos:
            marca = self.marca(marca_crm)
            if marca is not None:
                carteira.append(
                    evento(
                        "crm_customer_rep", {"customer_external_id": str(c["id"]), "app_login_key": resumo}, {}, marca
                    )
                )
        return cliente, carteira

    def compra_por_marca(self, r: dict) -> dict | None:
        marca = self.marca(r.get("marca_id"))
        if marca is None:
            return None
        return evento(
            "crm_customer_brand",
            {"customer_external_id": str(r["cliente_id"])},
            {
                "erp_first_purchase_on": r.get("primeira_compra"),
                "erp_last_purchase_on": r.get("ultima_compra"),
                "erp_total_purchased_cents": centavos(r.get("total_comprado")),
            },
            marca,
        )

    # ---------- leads ----------

    def negocio(self, n: dict, responsavel: str | None) -> dict:
        return evento(
            "crm_lead",
            {"kind": "deal", "external_id": str(n["id"])},
            {
                "code": n.get("codigo"),
                "customer_external_id": _texto(n.get("cliente_id")),
                "funnel_external_id": _texto(n.get("funil_id")),
                "origin": n.get("origem"),
                "assigned_rep_external_id": responsavel,
                "source_created_at": n.get("criado_em"),
                "source_updated_at": n.get("atualizado_em"),
            },
            self.marca(n.get("marca_id")),
        )

    @staticmethod
    def lead_sdr(s: dict) -> dict:
        return evento(
            "crm_lead",
            {"kind": "sdr", "external_id": str(s["id"])},
            {
                "customer_external_id": _texto(s.get("cliente_id")),
                "source_created_at": s.get("criado_em"),
                "source_updated_at": s.get("atualizado_em"),
            },
        )

    # ---------- pedidos ----------

    def pedido(self, p: dict, itens: list[dict]) -> dict | None:
        marca = self.marca(p.get("marca_id"))
        status_crm = str(p.get("status") or "")
        status = {"orcamento": "quote", "enviado": "sent", "faturado": "sent", "cancelado": "cancelled"}.get(status_crm)
        if marca is None or status is None:
            return None
        total = Decimal(0)
        for item in itens:
            try:
                total += Decimal(str(item.get("quantidade") or 0)) * Decimal(str(item.get("preco_unitario") or 0))
            except (InvalidOperation, ValueError):
                continue
        vendedor = resumo_do_login(self.chave_hmac, p.get("vendedor_app"))
        return evento(
            "crm_order",
            {"external_id": str(p["id"])},
            {
                "customer_external_id": _texto(p.get("cliente_id")),
                "status": status,
                "is_invoiced": status_crm == "faturado",
                "total_cents": centavos(total),
                "sales_rep_app_login_key": vendedor[1] if vendedor and self.marca(vendedor[0]) == marca else None,
                "source_created_at": p.get("criado_em"),
                "source_updated_at": p.get("atualizado_em"),
            },
            marca,
        )

    def sincronizacao(self, s: dict) -> dict | None:
        if s.get("ok") is None or s.get("disparo") not in DISPAROS or not s.get("iniciada_em"):
            return None  # rodada ainda em andamento: vem na próxima leitura
        return evento(
            "crm_upstream_run",
            {"external_id": str(s["id"])},
            {
                "run_trigger": s["disparo"],
                "started_at": s["iniciada_em"],
                "finished_at": s.get("terminada_em"),
                "is_ok": bool(s["ok"]),
            },
            self.marca(s.get("marca_id")),
        )


def _texto(valor: Any) -> str | None:
    return None if valor is None else str(valor)
