# deedlit.api — BFF gateway (no DB). Build context: deedlit.api/
FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir "fastapi>=0.116.0" "uvicorn[standard]>=0.35.0" "httpx>=0.27.0"
COPY app.py clients.py mcp.py ./

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --retries=10     CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
