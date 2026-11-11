"""The local chat assistant's code-side half: tools that supply card and rule facts.

The model (a later PR) chooses which tool to call and judges strategy; every
card and rule fact it sees comes from these tools, read from the dated data
snapshot under ``data/processed/``. See ``tools.py``.
"""
