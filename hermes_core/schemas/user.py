from pydantic import BaseModel
from typing import Optional


class UserCreate(BaseModel):
    username: str
    cefr_level: str = "B1"


class UserOut(BaseModel):
    id: int
    username: str
    cefr_level: str
    grammar_scores: dict
    vocabulary_mastery: dict

    model_config = {"from_attributes": True}


class WeaknessReport(BaseModel):
    weakest_grammar: list[dict]    # [{"category": "past_simple", "score": 0.34}]
    weakest_vocabulary: list[dict]  # [{"word": "ephemeral", "score": 0.2}]
    recommended_focus: list[str]
