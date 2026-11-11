"""The local chat assistant's code-side half: tools that supply card, rules and deck facts.

The model (a later PR) chooses which tool to call and judges strategy; every
card, rule and deck fact it sees comes from these tools, read from the dated
data snapshot under ``data/processed/`` and the public decks under
``data/raw/decks/``. See ``tools.py`` (card and rules tools, the registry) and
``decks.py`` (deck tools).
"""

# Import order matters: ``tools`` registers the deck tools at its end and
# ``decks`` imports helpers from ``tools``, so ``tools`` must start first. Doing
# it here makes that hold whichever submodule a caller imports.
from games.cyberpunk.assistant import tools  # noqa: E402,F401
