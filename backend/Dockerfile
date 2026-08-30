FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run injects the PORT env var at runtime (defaults to 8080) —
# the app must listen on whatever it's set to.
CMD exec uvicorn api:app --host 0.0.0.0 --port ${PORT:-8080}