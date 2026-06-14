# deedlit.api — BFF gateway (no DB). Build context: deedlit.api/
FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir "fastapi>=0.116.0" "uvicorn[standard]>=0.35.0" "httpx>=0.27.0" \
    "opentelemetry-distro>=0.48b0" "opentelemetry-exporter-otlp-proto-http>=1.27.0" \
    "opentelemetry-instrumentation-fastapi>=0.48b0" "opentelemetry-instrumentation-httpx>=0.48b0"
COPY app.py clients.py mcp.py activity.py ./

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --retries=10     CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
# opentelemetry-instrument wraps uvicorn for zero-code tracing; OTEL_* env
# (endpoint/service name/protocol) is supplied by docker-compose.
CMD ["opentelemetry-instrument", "python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
