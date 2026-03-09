FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y build-essential ffmpeg && rm -rf /var/lib/apt/lists/*

COPY hermes_worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m spacy download en_core_web_sm

# Copier tous les packages depuis la racine du projet
COPY hermes_core/ ./hermes_core/
COPY hermes_llm/ ./hermes_llm/
COPY hermes_worker/ ./hermes_worker/

CMD ["celery", "-A", "hermes_worker.worker", "worker", "--loglevel=info", "--concurrency=1"]
