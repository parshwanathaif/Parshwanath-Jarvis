"""Skill registry. Order matters: the first matching route answers."""
from types import SimpleNamespace as _S

from . import ai, calc, general, market, portfolio, web

ALL = [
    _S(register=web.register_early),   # user-defined connections win over everything
    general,
    _S(register=ai.register),          # "analyse ...", "should I ..." go to the AI brain when it is on
    portfolio,
    calc,
    web,
    market,
    _S(register=web.register_late),    # who is / what is -> Wikipedia
    _S(register=ai.register_last),     # everything else
]
