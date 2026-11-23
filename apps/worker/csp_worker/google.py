"""Sessão HTTP do Google com a conta de serviço de leitura (decisão 0036).

A chave vem de GOOGLE_SERVICE_ACCOUNT_JSON (o JSON inteiro, guardado só no Railway). Nunca vai para log nem para a
mensagem de erro: a falha diz só o que fazer.
"""

from __future__ import annotations

import json
from typing import Any

from .ga4 import ESCOPO, ErroDoGa4

TEMPO_LIMITE_S = 60


def sessao_do_google(chave_json: str | None):
    if not chave_json:
        raise ErroDoGa4("AUTH", "GOOGLE_SERVICE_ACCOUNT_JSON vazio: cadastre a chave da conta de serviço no Railway")
    try:
        info = json.loads(chave_json)
    except json.JSONDecodeError as erro:
        raise ErroDoGa4("AUTH", "GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido") from erro
    if info.get("type") != "service_account":
        raise ErroDoGa4("AUTH", "GOOGLE_SERVICE_ACCOUNT_JSON não é a chave de uma conta de serviço")

    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    credencial = service_account.Credentials.from_service_account_info(info, scopes=[ESCOPO])
    return AuthorizedSession(credencial)


def chamada_http(sessao) -> Any:
    """Transforma a sessão autenticada numa `Chamada` do adaptador, traduzindo os erros da API em códigos curtos."""

    def chamar(url: str, corpo: dict[str, Any]) -> dict[str, Any]:
        resposta = sessao.post(url, json=corpo, timeout=TEMPO_LIMITE_S)
        if resposta.status_code in (401, 403):
            raise ErroDoGa4(
                "PERMISSION",
                "o GA4 recusou a conta de serviço: confira se ela é Leitor na propriedade",
            )
        if resposta.status_code == 404:
            raise ErroDoGa4("NOT_FOUND", "propriedade do GA4 não encontrada: confira o ID numérico cadastrado")
        if resposta.status_code == 429:
            raise ErroDoGa4("RATE_LIMIT", "cota do GA4 esgotada nesta hora; a próxima rodada tenta de novo")
        if resposta.status_code >= 400:
            raise ErroDoGa4("GA4_API", f"o GA4 respondeu {resposta.status_code}")
        return resposta.json()

    return chamar
