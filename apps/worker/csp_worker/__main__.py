"""`python -m csp_worker ga4`: roda o trabalho `ga4_daily` uma vez e sai (o agendador do Railway chama às 14:00).

Variáveis (nomes no .env.example): WORKER_DATABASE_URL (papel mkt_worker) e GOOGLE_SERVICE_ACCOUNT_JSON.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from .ga4 import DIAS_DE_RELEITURA, ErroDoGa4

FUSO = ZoneInfo("America/Sao_Paulo")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="csp_worker")
    parser.add_argument("trabalho", choices=["ga4"])
    parser.add_argument("--dias", type=int, default=DIAS_DE_RELEITURA, help="dias completos a reler (padrão 14)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    url = os.environ.get("WORKER_DATABASE_URL")
    if not url:
        print("WORKER_DATABASE_URL vazio: o worker entra no banco com o papel mkt_worker.", file=sys.stderr)
        return 2

    import psycopg

    from .banco import Banco
    from .google import chamada_http, sessao_do_google
    from .rodada_ga4 import rodar

    try:
        chamar = chamada_http(sessao_do_google(os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")))
    except ErroDoGa4 as erro:
        print(str(erro), file=sys.stderr)
        return 2

    with psycopg.connect(url, application_name="csp-worker") as conexao:
        r = rodar(Banco(conexao), chamar, datetime.now(FUSO).date(), args.dias)
    logging.getLogger("csp_worker").info(
        "ga4_daily: %s, %d linhas, %d recusadas%s",
        r.status,
        r.linhas,
        r.recusadas,
        f", falhas {', '.join(r.falhas)}" if r.falhas else "",
    )
    return 1 if r.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
