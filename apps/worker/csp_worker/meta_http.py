"""Chamada HTTP da Meta com o token do usuário do sistema de leitura (decisão 0036).

O token vem de META_ACCESS_TOKEN_READ e o segredo do app de META_APP_SECRET (os dois só no Railway). Toda chamada leva
o `appsecret_proof`. O token nunca vai para log nem para a mensagem de erro: a falha diz só o que fazer.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time
from typing import Any

from .meta import URL_BASE, Chamada, ErroDaMeta

TEMPO_LIMITE_S = 60
TENTATIVAS = 5
# Erros de limite da Meta: esperam e repetem (integracoes.md, seção 4).
CODIGOS_DE_LIMITE = {4, 17, 32, 613} | set(range(80000, 80015))


def chamada_da_meta(token: str | None, segredo: str | None, sessao=None, dormir=time.sleep) -> Chamada:
    if not token:
        raise ErroDaMeta("AUTH", "META_ACCESS_TOKEN_READ vazio: cadastre o token do usuário do sistema no Railway")
    if not segredo:
        raise ErroDaMeta("AUTH", "META_APP_SECRET vazio: cadastre a chave secreta do app no Railway")
    if sessao is None:
        import requests

        sessao = requests.Session()
    prova = hmac.new(segredo.encode(), token.encode(), hashlib.sha256).hexdigest()

    def chamar(caminho: str, parametros: dict[str, Any]) -> dict[str, Any]:
        if caminho.startswith("https://"):
            url, params = caminho, None  # a URL de paginação já traz tudo, inclusive o token
        else:
            url = URL_BASE + caminho
            params = {**parametros, "access_token": token, "appsecret_proof": prova}
        espera = 1.0
        for tentativa in range(TENTATIVAS):
            try:
                resposta = sessao.get(url, params=params, timeout=TEMPO_LIMITE_S)
            except Exception as erro:  # rede: espera e repete
                if tentativa == TENTATIVAS - 1:
                    raise ErroDaMeta("NETWORK", "sem resposta da Meta depois de 5 tentativas") from erro
                dormir(espera)
                espera *= 2
                continue
            if resposta.status_code < 400:
                return resposta.json()
            erro = _erro(resposta)
            codigo = erro.get("code")
            if resposta.status_code >= 500 or codigo in CODIGOS_DE_LIMITE:
                if tentativa == TENTATIVAS - 1:
                    raise ErroDaMeta("RATE_LIMIT" if codigo in CODIGOS_DE_LIMITE else "META_API", _texto(erro))
                dormir(max(espera, 60.0) if codigo in CODIGOS_DE_LIMITE else espera)
                espera *= 2
                continue
            if codigo == 190:
                raise ErroDaMeta("TOKEN_INVALID", "a Meta recusou o token: gere de novo o token do usuário do sistema")
            if codigo in (10, 200, 294) or resposta.status_code == 403:
                raise ErroDaMeta(
                    "PERMISSION",
                    "sem permissão na conta: confira se o usuário do sistema tem a conta de anúncio e ads_read",
                )
            if codigo == 100:
                # 100 é "parâmetro inválido"; só o subcódigo 33 quer dizer que o objeto não existe ou não está visível.
                if erro.get("error_subcode") == 33:
                    raise ErroDaMeta("NOT_FOUND", f"{_etapa(url)}: a Meta não achou a conta ({_texto(erro)})")
                motivo = _motivo(erro, token)
                raise ErroDaMeta("BAD_REQUEST", f"{_etapa(url)}: a Meta recusou o pedido ({_texto(erro)}){motivo}")
            raise ErroDaMeta(f"HTTP_{resposta.status_code}", _texto(erro))
        raise ErroDaMeta("META_API", "sem resposta da Meta")

    return chamar


def _erro(resposta) -> dict:
    try:
        return resposta.json().get("error") or {}
    except ValueError:
        return {}


def _etapa(url: str) -> str:
    """O último pedaço do caminho (campaigns, insights, act_...): diz qual leitura falhou, sem token nem parâmetro."""
    return url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1] or "?"


def _motivo(erro: dict, token: str) -> str:
    """No parâmetro inválido, a mensagem da Meta diz qual parâmetro e o que ela aceita: sem dado pessoal nem token.
    Vai cortada e sem nada que pareça token, por garantia."""
    mensagem = str(erro.get("message") or "").replace(token, "…")
    mensagem = re.sub(r"[A-Za-z0-9_-]{40,}", "…", mensagem)[:200]
    return f": {mensagem}" if mensagem else ""


def _texto(erro: dict) -> str:
    """Só o código e o subcódigo: a mensagem da Meta pode repetir ids e nomes."""
    return f"erro {erro.get('code', '?')}/{erro.get('error_subcode', '-')}"
