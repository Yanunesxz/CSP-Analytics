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


class _Resposta:
    def __init__(self, status, corpo):
        self.status_code = status
        self._corpo = corpo

    def json(self):
        if self._corpo is None:
            raise ValueError("sem json")
        return self._corpo


@pytest.mark.parametrize(
    ("corpo", "motivo"),
    [
        ({"error": {"status": "PERMISSION_DENIED", "details": [{"reason": "SERVICE_DISABLED"}]}}, "SERVICE_DISABLED"),
        ({"error": {"status": "PERMISSION_DENIED", "message": "x"}}, "PERMISSION_DENIED"),
        (None, None),
    ],
)
def test_motivo_do_google(corpo, motivo):
    from csp_worker.google import motivo_do_google

    assert motivo_do_google(_Resposta(403, corpo)) == motivo


def test_api_desligada_diz_o_que_fazer():
    from csp_worker.ga4 import ErroDoGa4
    from csp_worker.google import chamada_http

    class Sessao:
        def post(self, *a, **k):
            return _Resposta(403, {"error": {"details": [{"reason": "SERVICE_DISABLED"}]}})

    with pytest.raises(ErroDoGa4) as erro:
        chamada_http(Sessao())("https://x", {})
    assert "Data API" in str(erro.value)
