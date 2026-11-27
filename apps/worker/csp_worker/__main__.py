"""`python -m csp_worker <trabalho>`: roda um trabalho uma vez e sai (o agendador do Railway chama).

- `ga4`: o `ga4_daily` (às 14:00), últimos 14 dias completos.
- `meta`: o `ads_backfill` da Meta (às 04:00), últimos 28 dias; `--desde AAAA-MM-DD` faz a primeira carga.
- `meta-hora`: o `ads_hourly` da Meta (de hora em hora), hoje e ontem.
- `crm`: o `crm_incremental` do CSP 360 (a cada 5 min), a janela de 3 dias.
- `crm-completa`: o `crm_full_pass` do CSP 360 (às 03:00), tudo, apagando o que sumiu do CRM.

Variáveis (nomes no .env.example): WORKER_DATABASE_URL (papel mkt_worker), GOOGLE_SERVICE_ACCOUNT_JSON (ga4),
META_ACCESS_TOKEN_READ e META_APP_SECRET (meta), CSP360_API_URL, CSP360_API_KEY, CSP360_API_TOKEN e
REP_LOGIN_HMAC_KEY (crm).
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from .ga4 import DIAS_DE_RELEITURA, ErroDoGa4

FUSO = ZoneInfo("America/Sao_Paulo")
LOG = logging.getLogger("csp_worker")
# O Railway perde a saída de um contêiner que termina em menos de ~1 s (24/11/2026: só "Starting Container", sem
# nenhuma linha). A espera no fim dá tempo de o coletor ler; 0 desliga (testes).
ESPERA_NO_FIM = float(os.environ.get("WORKER_ESPERA_NO_FIM", "3"))


class ParadoDeFora(Exception):  # noqa: N818 (o nome diz o que aconteceu)
    """O Railway (ou alguém) mandou parar o contêiner no meio da rodada: um deploy novo, outro Run now."""


def _ao_receber_sigterm(_sinal, _quadro) -> None:
    raise ParadoDeFora("o contêiner recebeu SIGTERM no meio da rodada (deploy novo ou outro Run now)")


def url_de_banco_valida(url: str) -> bool:
    """A conexão do worker é sempre uma URL postgresql:// com usuário e host (nunca só a senha)."""
    if not url.startswith(("postgresql://", "postgres://")):
        return False
    resto = url.split("://", 1)[1]
    return "@" in resto and bool(resto.rsplit("@", 1)[1].strip("/"))


def main(argv: list[str] | None = None) -> int:
    # Tudo no stdout, sem buffer: cada linha sai na hora, mesmo se o processo morrer logo depois.
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s", stream=sys.stdout, force=True
    )
    # Sem isto, o SIGTERM mata o processo calado. Com ele, a rodada fecha como falha e o log diz o motivo.
    signal.signal(signal.SIGTERM, _ao_receber_sigterm)
    try:
        return _rodar(argv)
    except ParadoDeFora as erro:
        LOG.error("%s", erro)
        return 1
    except SystemExit:
        raise
    except BaseException:
        LOG.exception("o worker parou com um erro inesperado")
        return 1
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        if ESPERA_NO_FIM > 0:
            time.sleep(ESPERA_NO_FIM)


def _rodar(argv: list[str] | None) -> int:
    parser = argparse.ArgumentParser(prog="csp_worker")
    parser.add_argument("trabalho", choices=["ga4", "meta", "meta-hora", "crm", "crm-completa"])
    parser.add_argument("--dias", type=int, default=None, help="dias a reler (ga4: 14; meta: 28)")
    parser.add_argument("--desde", type=date.fromisoformat, default=None, help="meta: primeira carga desde a data")
    args = parser.parse_args(argv)
    if args.dias is None:
        args.dias = {"ga4": DIAS_DE_RELEITURA, "meta": 28, "meta-hora": 2, "crm": 3, "crm-completa": 0}[args.trabalho]
    LOG.info("começando o %s (%d dias)", args.trabalho, args.dias)

    url = (os.environ.get("WORKER_DATABASE_URL") or "").strip()
    if not url:
        LOG.error("WORKER_DATABASE_URL vazio: o worker entra no banco com o papel mkt_worker.")
        return 2
    if not url_de_banco_valida(url):
        # Nunca o valor: um engano comum é colar só a senha aqui, e ela iria para o log.
        LOG.error(
            "WORKER_DATABASE_URL fora do formato: use a URL inteira do Session pooler, "
            "postgresql://mkt_worker.<ref>:<senha>@<host>:5432/postgres"
        )
        return 2

    if args.trabalho in ("crm", "crm-completa"):
        return _rodar_crm(url, args.trabalho == "crm-completa")
    if args.trabalho != "ga4":
        return _rodar_meta(url, args)

    import psycopg

    from .banco import Banco
    from .google import chamada_http, sessao_do_google
    from .rodada_ga4 import rodar

    try:
        chamar = chamada_http(sessao_do_google(os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")))
    except ErroDoGa4 as erro:
        LOG.error("%s", erro)
        return 2
    LOG.info("credencial do Google lida; conectando no banco")

    try:
        conexao = psycopg.connect(url, application_name="csp-worker", connect_timeout=20)
    except psycopg.ProgrammingError:
        # A mensagem do psycopg repete pedaços da conexão (e da senha): não vai para o log.
        LOG.error("WORKER_DATABASE_URL não pôde ser lida como conexão do Postgres; confira o formato da URL.")
        return 2
    with conexao:
        r = rodar(Banco(conexao), chamar, datetime.now(FUSO).date(), args.dias)
    LOG.info(
        "ga4_daily: %s, %d linhas, %d recusadas%s",
        r.status,
        r.linhas,
        r.recusadas,
        f", falhas {', '.join(r.falhas)}" if r.falhas else "",
    )
    return 1 if r.status == "failed" else 0


def _conectar(url: str):
    import psycopg

    try:
        return psycopg.connect(url, application_name="csp-worker", connect_timeout=20)
    except psycopg.ProgrammingError:
        # A mensagem do psycopg repete pedaços da conexão (e da senha): não vai para o log.
        LOG.error("WORKER_DATABASE_URL não pôde ser lida como conexão do Postgres; confira o formato da URL.")
        return None


def _rodar_meta(url: str, args) -> int:
    from .banco import Banco
    from .meta import ErroDaMeta, Janela, janela_de_releitura
    from .meta_http import chamada_da_meta
    from .rodada_meta import rodar

    try:
        chamar = chamada_da_meta(os.environ.get("META_ACCESS_TOKEN_READ"), os.environ.get("META_APP_SECRET"))
    except ErroDaMeta as erro:
        LOG.error("%s", erro)
        return 2
    hoje = datetime.now(FUSO).date()
    if args.desde is not None:
        janela = Janela(inicio=args.desde, fim=hoje)
    else:
        janela = janela_de_releitura(hoje, args.dias)
    trabalho = "ads_hourly" if args.trabalho == "meta-hora" else "ads_backfill"
    LOG.info("token da Meta lido; lendo de %s a %s", janela.inicio, janela.fim)

    conexao = _conectar(url)
    if conexao is None:
        return 2
    resultados = []
    with conexao:
        banco = Banco(conexao)
        # A primeira carga vai em blocos de 30 dias: a Meta recusa consulta grande demais numa chamada.
        inicio = janela.inicio
        while inicio <= janela.fim:
            fim = min(inicio + timedelta(days=29), janela.fim)
            resultados.append(rodar(banco, chamar, Janela(inicio=inicio, fim=fim), trabalho))
            inicio = fim + timedelta(days=1)
    for r in resultados:
        LOG.info(
            "%s: %s, %d linhas, %d recusadas%s",
            trabalho,
            r.status,
            r.linhas,
            r.recusadas,
            f", falhas {', '.join(r.falhas)}" if r.falhas else "",
        )
    return 1 if any(r.status == "failed" for r in resultados) else 0


def _rodar_crm(url: str, completa: bool) -> int:
    from .banco import Banco
    from .crm import Conversor
    from .crm_http import ErroDoCrm, chamada_do_crm
    from .rodada_crm import rodar

    try:
        chamar = chamada_do_crm(
            os.environ.get("CSP360_API_URL"), os.environ.get("CSP360_API_KEY"), os.environ.get("CSP360_API_TOKEN")
        )
    except ErroDoCrm as erro:
        LOG.error("%s", erro)
        return 2
    chave = (os.environ.get("REP_LOGIN_HMAC_KEY") or "").strip()
    if len(chave) < 32:
        LOG.error("REP_LOGIN_HMAC_KEY vazio ou curto (mínimo 32 caracteres): gere uma vez e guarde só no Railway.")
        return 2
    conexao = _conectar(url)
    if conexao is None:
        return 2
    with conexao:
        r = rodar(Banco(conexao), chamar, Conversor(chave.encode()), completa, datetime.now(UTC).date())
    LOG.info(
        "%s: %s, %d linhas, %d recusadas, %d apagadas; lidas %s%s",
        "crm_full_pass" if completa else "crm_incremental",
        r.status,
        r.linhas,
        r.recusadas,
        r.apagadas,
        ", ".join(f"{v}={n}" for v, n in r.lidas.items()) or "nenhuma",
        f"; {r.codigo}: {r.mensagem}" if r.codigo else "",
    )
    return 1 if r.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
