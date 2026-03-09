"""
Service de gestion du profil apprenant.

Le profil est généré par le LLM à partir des scores + erreurs de l'utilisateur.
Il est mis en cache sur User.learner_profile et régénéré toutes les 24h
ou dès qu'une session est terminée (si le profil a plus de 6h).
"""
import datetime
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from hermes_core.models.user import User
from hermes_llm.client import OllamaClient

log = logging.getLogger(__name__)

REGEN_AFTER_SESSION_HOURS = 6    # Régénère après session si profil > 6h
REGEN_NIGHTLY_HOURS = 24         # Régénère en nightly si > 24h
MIN_ERRORS_TO_PROFILE = 5        # Pas de profil avant 5 erreurs (trop peu de données)


def _profile_age_hours(user: User) -> float | None:
    """Retourne l'âge du profil en heures, ou None si jamais généré."""
    if not user.learner_profile_updated_at:
        return None
    delta = datetime.datetime.utcnow() - user.learner_profile_updated_at
    return delta.total_seconds() / 3600


def should_regenerate(user: User, after_session: bool = False) -> bool:
    """
    Décide si le profil doit être régénéré.
    - after_session=True : seuil de 6h (plus fréquent)
    - after_session=False : seuil de 24h (nightly)
    """
    error_count = len(user.error_log or [])
    if error_count < MIN_ERRORS_TO_PROFILE:
        return False  # Pas assez de données

    age = _profile_age_hours(user)
    if age is None:
        return True  # Jamais généré

    threshold = REGEN_AFTER_SESSION_HOURS if after_session else REGEN_NIGHTLY_HOURS
    return age > threshold


async def generate_learner_profile(user: User, client: OllamaClient) -> str:
    """Appelle le LLM pour générer le profil. Retourne la string ou ""."""
    from hermes_llm.prompts.learner_profile import build_learner_profile_prompt
    try:
        prompt = build_learner_profile_prompt(user)
        data = await client.generate_json(prompt, temperature=0.3, thinking=False)
        return data.get("profile", "").strip()
    except Exception as exc:
        log.warning("learner_profile generation failed: %s", exc)
        return ""


async def refresh_profile_if_needed(
    user: User,
    client: OllamaClient,
    db: AsyncSession,
    after_session: bool = False,
) -> str | None:
    """
    Régénère le profil si nécessaire.
    Ne lève pas d'exception — les erreurs sont loggées silencieusement.
    Retourne le profil (nouveau ou existant).
    """
    if not should_regenerate(user, after_session=after_session):
        return user.learner_profile

    log.info("Regenerating learner profile for user %s", user.id)
    profile = await generate_learner_profile(user, client)
    if profile:
        user.learner_profile = profile
        user.learner_profile_updated_at = datetime.datetime.utcnow()
        await db.commit()
        log.info("Learner profile updated for user %s (%d chars)", user.id, len(profile))
    return user.learner_profile
