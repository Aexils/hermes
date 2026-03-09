from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str
    redis_url: str = "redis://redis:6379/0"
    ollama_host: str = "http://ollama:11434"
    ollama_model: str = "qwen3.5:9b"

    # Booklore
    booklore_api: str = "http://booklore:6060"
    booklore_refresh_token: str = ""
    booklore_username: str = ""   # Préféré : login direct, évite les problèmes de rotation
    booklore_password: str = ""
    books_path: str = "/books"  # Volume monté depuis C:\Users\alexi\Desktop\booklore\bookdrop

    # Audiobookshelf
    audiobookshelf_api: str = "http://audiobookshelf:13378"
    audiobookshelf_token: str = ""  # API token généré dans ABS → Settings → Users
    audiobooks_path: str = "/audiobooks"  # Volume monté depuis la librairie ABS

    # Whisper (transcription)
    # GPU : medium ou large-v3 recommandés / CPU : base
    whisper_model: str = "medium"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
