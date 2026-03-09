FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y build-essential ffmpeg && rm -rf /var/lib/apt/lists/*

COPY hermes_core/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m spacy download en_core_web_sm

# Copier tous les packages depuis la racine du projet
COPY hermes_core/ ./hermes_core/
COPY hermes_llm/ ./hermes_llm/
COPY scripts/ ./scripts/
COPY alembic/ ./alembic/
COPY alembic.ini .

CMD ["uvicorn", "hermes_core.main:app", "--host", "0.0.0.0", "--port", "8000"]
