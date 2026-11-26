"""A entrada do worker nunca escreve a conexão (nem a senha) no log quando ela vem errada."""

import pytest

from csp_worker import __main__ as entrada

SENHA = "senha-inventada-para-o-teste-0123456789abcdef"


@pytest.mark.parametrize(
    "url",
    [
        SENHA,
        f"postgresql://mkt_worker:{SENHA}",
        "mysql://u:p@host/db",
        "postgresql://u:p@",
    ],
)
def test_url_errada_sai_sem_mostrar_o_valor(url, monkeypatch, caplog, capsys):
    monkeypatch.setattr(entrada, "ESPERA_NO_FIM", 0)
    monkeypatch.setenv("WORKER_DATABASE_URL", url)
    assert entrada.main(["ga4"]) == 2
    saida = caplog.text + "".join(capsys.readouterr())
    assert "fora do formato" in saida
    assert SENHA not in saida
    assert url not in saida


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://mkt_worker.abc:segredo@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
        "postgres://u:p@localhost/db",
    ],
)
def test_url_certa_passa(url):
    assert entrada.url_de_banco_valida(url)
