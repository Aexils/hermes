from celery import Celery
from celery.schedules import crontab
from hermes_core.config import get_settings

settings = get_settings()

app = Celery(
    "hermes_worker",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "hermes_worker.tasks.generate_batch",
        "hermes_worker.tasks.sync_progress",
        "hermes_worker.tasks.transcribe_book",
    ],
)

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        # Fallback : vérifie les batches manquants toutes les 24h
        "check-pending-batches": {
            "task": "hermes_worker.tasks.generate_batch.check_and_generate_pending",
            "schedule": crontab(hour=8, minute=0),
        },
        # Sync Booklore toutes les heures
        "booklore-sync": {
            "task": "hermes_worker.tasks.sync_progress.sync_all_users",
            "schedule": crontab(minute=0),
        },
    },
)
