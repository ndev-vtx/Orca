# syntax=docker/dockerfile:1
# Orca — single-service web build: FastAPI backend + built React frontend,
# one process on one port. Data (SQLite db + audio cache) lives in /data.

FROM node:20-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend/orca /app/orca
COPY --from=frontend /build/dist /app/static

ENV ORCA_HOST=0.0.0.0 \
    ORCA_PORT=8765 \
    ORCA_DATA_DIR=/data \
    ORCA_STATIC_DIR=/app/static
# PaaS providers (Render, Railway, Koyeb, Fly) inject their own PORT;
# the shell form honors it and falls back to 8765 for plain Docker.
EXPOSE 8765

RUN useradd --create-home orca \
    && mkdir -p /data \
    && chown -R orca:orca /app /data
USER orca

CMD ["sh", "-c", "python -m uvicorn orca.server:app --host 0.0.0.0 --port ${PORT:-8765}"]
