# Imagem do worker no Railway. Sem este arquivo o Railway vê o package.json desta pasta, monta um app Node e o
# Python fica sem as dependências do pyproject.toml (25/11/2026: "No module named 'psycopg'"). Com um Dockerfile
# na raiz do serviço (apps/worker), o Railway usa ele no lugar da detecção automática.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY csp_worker ./csp_worker
RUN pip install .

# O comando do serviço no Railway (python -m csp_worker ga4) vale por cima deste.
CMD ["python", "-m", "csp_worker", "ga4"]
