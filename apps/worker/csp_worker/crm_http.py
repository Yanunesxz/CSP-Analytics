"""Leitura das 12 views do esquema `csp_mkt` do CRM pela API de dados de lá (decisão 0040).

Três variáveis, só no Railway: CSP360_API_URL (o endereço do projeto do CRM), CSP360_API_KEY (a chave pública da API
de lá, que sozinha não lê as views) e CSP360_API_TOKEN (o token do papel de leitura, segredo). Toda chamada pede a
view com a lista exata de colunas: coluna ou view que sumiu faz a API recusar, e a rodada termina com SCHEMA_DRIFT.
Paginação sempre por chave, nunca por número de página. O token nunca vai para log nem para a mensagem de erro.
"""

from __future__ import annotations

import base64
import json
import time
from collections.abc import Callable, Iterator
from typing import Any

TEMPO_LIMITE_S = 60
TENTATIVAS = 5
PAGINA = 1000
# Coluna ou view que não existe (Postgres e PostgREST): o CRM mudou.
CODIGOS_DE_MUDANCA = ("42703", "42P01", "PGRST200", "PGRST204", "PGRST205", "PGRST100")

# A lista fechada de views e colunas (integracoes.md, quadro 3.2). A ordem das colunas não importa para a API.
VIEWS: dict[str, tuple[str, ...]] = {
    "marcas": ("id", "sigla", "nome_fantasia"),
    "funis_venda": ("id", "nome", "padrao"),
    "usuarios": ("id", "papel", "ativo", "logins_app"),
    "clientes": ("id", "codigo", "status", "criado_em", "retrato_carregado", "donos_app"),
    "negocios": ("id", "codigo", "cliente_id", "marca_id", "funil_id", "origem", "criado_em", "atualizado_em"),
    "leads_sdr": ("id", "criado_em", "atualizado_em", "cliente_id"),
    "pedidos": ("id", "marca_id", "cliente_id", "status", "criado_em", "atualizado_em", "vendedor_app"),
    "pedido_itens": ("pedido_id", "quantidade", "preco_unitario"),
    "sincronizacoes": ("id", "marca_id", "disparo", "iniciada_em", "terminada_em", "ok"),
    "clientes_utm": ("cliente_id", "utm_source", "utm_medium", "utm_campaign"),
    "clientes_compras_marca": ("cliente_id", "marca_id", "primeira_compra", "ultima_compra", "total_comprado"),
    "negocios_responsavel": ("negocio_id", "responsavel_id"),
}


class ErroDoCrm(Exception):
    def __init__(self, codigo: str, mensagem: str):
        super().__init__(mensagem)
        self.codigo = codigo


# (view, parâmetros da API) -> linhas
Chamada = Callable[[str, dict[str, str]], list[dict[str, Any]]]


def _limpo(valor: str | None) -> str:
    """O valor como foi colado no Railway, sem espaço, quebra de linha nem aspas em volta."""
    valor = (valor or "").strip()
    while len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
        valor = valor[1:-1].strip()
    return valor


def diagnostico_do_token(token: str, agora: float | None = None) -> str:
    """O que dá para dizer do token sem mostrar nada dele que valha como segredo: quantas partes, o algoritmo, o
    papel (o nome da geração) e se já venceu. A assinatura nunca entra."""
    partes = token.split(".")
    if len(partes) != 3:
        return f"o valor colado não é um token (tem {len(partes)} partes separadas por ponto, e o token tem 3)"
    try:
        cabecalho, claims = (json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4))) for p in partes[:2])
    except ValueError:
        return "o valor colado tem 3 partes, mas não se lê como token"
    papel = str(claims.get("role", "?"))
    if not papel.startswith("csp_mkt_api_"):
        papel = "outro papel, não é uma geração do CSP-MKT"
    vence = claims.get("exp")
    agora = time.time() if agora is None else agora
    situacao = "vencido" if isinstance(vence, (int, float)) and vence <= agora else "no prazo"
    return f"token {cabecalho.get('alg', '?')}, papel {papel}, {situacao}"


def chamada_do_crm(url: str | None, chave: str | None, token: str | None, sessao=None, dormir=time.sleep) -> Chamada:
    url = _limpo(url).rstrip("/")
    chave = _limpo(chave)
    token = _limpo(token)
    if not url.startswith("https://"):
        raise ErroDoCrm("CONFIG", "CSP360_API_URL vazio ou fora do formato: use https://<ref>.supabase.co do CRM")
    if not chave:
        raise ErroDoCrm("CONFIG", "CSP360_API_KEY vazio: cadastre a chave pública (anon) do CRM no Railway")
    if not token:
        raise ErroDoCrm("AUTH", "CSP360_API_TOKEN vazio: gere o token no CRM e cole no Railway")
    if url.endswith("/rest/v1"):
        url = url[: -len("/rest/v1")]
    if sessao is None:
        import requests

        sessao = requests.Session()
    cabecalhos = {
        "apikey": chave,
        "Authorization": f"Bearer {token}",
        "Accept-Profile": "csp_mkt",
        "Accept": "application/json",
    }

    def chamar(view: str, parametros: dict[str, str]) -> list[dict[str, Any]]:
        if view not in VIEWS:
            raise ValueError("view fora da lista")
        espera = 1.0
        for tentativa in range(TENTATIVAS):
            try:
                resposta = sessao.get(
                    f"{url}/rest/v1/{view}", params=parametros, headers=cabecalhos, timeout=TEMPO_LIMITE_S
                )
            except Exception as erro:  # rede: espera e repete
                if tentativa == TENTATIVAS - 1:
                    raise ErroDoCrm(
                        "NETWORK", f"{view}: sem resposta do CRM depois de {TENTATIVAS} tentativas"
                    ) from erro
                dormir(espera)
                espera *= 2
                continue
            if resposta.status_code < 400:
                return resposta.json()
            codigo = _codigo(resposta)
            if resposta.status_code >= 500 or resposta.status_code == 429:
                if tentativa == TENTATIVAS - 1:
                    raise ErroDoCrm("CRM_API", f"{view}: o CRM respondeu {resposta.status_code} ({codigo})")
                dormir(espera)
                espera *= 2
                continue
            if resposta.status_code == 401 or codigo in ("PGRST301", "PGRST302", "PGRST303"):
                raise ErroDoCrm(
                    "TOKEN_INVALID",
                    f"{view}: o CRM recusou o token ({codigo}; {diagnostico_do_token(token)}); "
                    "gere de novo pelo script do CRM e troque no Railway",
                )
            if (
                codigo in ("42703", "42P01", "PGRST200", "PGRST204", "PGRST205", "PGRST100")
                or resposta.status_code == 404
            ):
                raise ErroDoCrm("SCHEMA_DRIFT", f"{view}: a view ou uma coluna mudou no CRM ({codigo})")
            if codigo == "PGRST106":
                raise ErroDoCrm("SCHEMA_NOT_EXPOSED", "o esquema csp_mkt não está em Exposed schemas na API do CRM")
            if codigo == "42501" or resposta.status_code == 403:
                raise ErroDoCrm("PERMISSION", f"{view}: o papel do token não lê a view ({codigo})")
            raise ErroDoCrm(f"HTTP_{resposta.status_code}", f"{view}: o CRM recusou o pedido ({codigo})")
        raise ErroDoCrm("CRM_API", f"{view}: sem resposta do CRM")

    return chamar


def _codigo(resposta) -> str:
    """Só o código do erro (PGRST…, SQLSTATE): a mensagem da API pode repetir valores."""
    try:
        corpo = resposta.json()
    except ValueError:
        return "?"
    return str(corpo.get("code") or "?") if isinstance(corpo, dict) else "?"


def colunas(view: str) -> str:
    return ",".join(VIEWS[view])


def conferir_views(chamar: Chamada) -> None:
    """Pede cada view com a lista exata de colunas e nenhuma linha: o que mudou no CRM para a rodada antes de gravar."""
    for view in VIEWS:
        chamar(view, {"select": colunas(view), "limit": "0"})


def por_chave(
    chamar: Chamada, view: str, chave: str = "id", filtros: dict[str, str] | None = None, pagina: int = PAGINA
) -> Iterator[dict[str, Any]]:
    """Todas as linhas da view, em páginas de até `pagina`, pela chave (uuid), pedindo sempre o que vem depois da
    última lida. A chave tem de ser única na view."""
    ultima: str | None = None
    while True:
        parametros = {"select": colunas(view), "order": f"{chave}.asc", "limit": str(pagina), **(filtros or {})}
        if ultima is not None:
            parametros[chave] = f"gt.{ultima}"
        linhas = chamar(view, parametros)
        yield from linhas
        if len(linhas) < pagina:
            return
        ultima = str(linhas[-1][chave])


def por_ids(
    chamar: Chamada, view: str, coluna: str, ids: list[str], lote: int = 100, pagina: int = PAGINA
) -> Iterator[dict[str, Any]]:
    """As linhas da view cujo `coluna` está em `ids`, em lotes de ids. Um lote que enche a página é dividido em dois
    (a view pode não ter chave única, como pedido_itens); um id só com a página cheia é erro."""
    pendentes = [ids[i : i + lote] for i in range(0, len(ids), lote)]
    while pendentes:
        grupo = pendentes.pop(0)
        linhas = chamar(view, {"select": colunas(view), coluna: f"in.({','.join(grupo)})", "limit": str(pagina)})
        if len(linhas) < pagina:
            yield from linhas
            continue
        if len(grupo) == 1:
            raise ErroDoCrm("TOO_MANY_ROWS", f"{view}: um só {coluna} com {pagina} linhas ou mais")
        meio = len(grupo) // 2
        pendentes[:0] = [grupo[:meio], grupo[meio:]]
