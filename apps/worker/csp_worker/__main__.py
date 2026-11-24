"""`python -m csp_worker ga4`: roda o trabalho `ga4_daily` uma vez e sai (o agendador do Railway chama às 14:00).

Variáveis (nomes no .env.example): WORKER_DATABASE_URL (papel mkt_worker) e GOOGLE_SERVICE_ACCOUNT_JSON.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from .ga4 import DIAS_DE_RELEITURA, ErroDoGa4

FUSO = ZoneInfo("America/Sao_Paulo")
LOG = logging.getLogger("csp_worker")
# O Railway perde a saída de um contêiner que termina em menos de ~1 s (24/11/2026: só "Starting Container", sem
# nenhuma linha). A espera no fim dá tempo de o coletor ler; 0 desliga (testes).
ESPERA_NO_FIM = float(os.environ.get("WORKER_ESPERA_NO_FIM", "3"))


def main(argv: list[str] | None = None) -> int:
    # Tudo no stdout, sem buffer: cada linha sai na hora, mesmo se o processo morrer logo depois.
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s", stream=sys.stdout, force=True
    )
    try:
        return _rodar(argv)
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
    parser.add_argument("trabalho", choices=["ga4"])
    parser.add_argument("--dias", type=int, default=DIAS_DE_RELEITURA, help="dias completos a reler (padrão 14)")
    args = parser.parse_args(argv)
    LOG.info("começando o %s (%d dias)", args.trabalho, args.dias)

    url = os.environ.get("WORKER_DATABASE_URL")
    if not url:
        LOG.error("WORKER_DATABASE_URL vazio: o worker entra no banco com o papel mkt_worker.")
        return 2

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

    with psycopg.connect(url, application_name="csp-worker") as conexao:
        r = rodar(Banco(conexao), chamar, datetime.now(FUSO).date(), args.dias)
    LOG.info(
        "ga4_daily: %s, %d linhas, %d recusadas%s",
        r.status,
        r.linhas,
        r.recusadas,
        f", falhas {', '.join(r.falhas)}" if r.falhas else "",
    )
    return 1 if r.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
