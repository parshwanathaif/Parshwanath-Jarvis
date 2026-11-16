"""Optional AI brain (Claude) for anything the built-in skills cannot answer.

Enabled when the `anthropic` package is installed and ANTHROPIC_API_KEY is set
(in the environment or the .env file). Without it Jarvis still works fully for
every built-in command.
"""
import os

from ..core import Reply

HISTORY = []  # recent (question, answer) pairs, text only
MAX_TURNS = 6

SYSTEM = """You are {name}, a voice assistant for {user}, who runs an investing business in India.
Your reply is read aloud, so answer in plain spoken sentences with no markdown, bullets, tables or symbols,
normally in two to five sentences. Lead with the answer. Use rupees, lakh and crore for Indian amounts.
For investing questions give your reasoning and the main risks, state when a figure may be out of date,
and use web search when current prices, results or news matter. You inform decisions; {user} makes them."""


def available():
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def portfolio_context(j):
    book = j.store["portfolio"]
    if not book or not j.cfg.get("share_portfolio_with_ai"):
        return ""
    lines = ", ".join(f"{s} {h['qty']:g} @ {h['avg']:.2f}" for s, h in book.items())
    return f"\n\n[Context - my current holdings (symbol, quantity, average cost): {lines}]"


def ask(j, question):
    import anthropic

    client = anthropic.Anthropic()
    messages = []
    for user_text, answer in HISTORY[-MAX_TURNS:]:
        messages += [{"role": "user", "content": user_text}, {"role": "assistant", "content": answer}]
    messages.append({"role": "user", "content": question + portfolio_context(j)})
    try:
        for _ in range(3):  # resume if a web-search turn pauses
            response = client.beta.messages.create(
                model=j.cfg["ai_model"],
                max_tokens=4000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": "low"},
                system=SYSTEM.format(name=j.cfg["assistant_name"], user=j.cfg["user_name"]),
                tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 3}],
                messages=messages,
            )
            if response.stop_reason != "pause_turn":
                break
            messages.append({"role": "assistant", "content": response.content})
    except anthropic.AuthenticationError:
        return "The AI key was rejected. Please check ANTHROPIC_API_KEY in the .env file."
    except anthropic.RateLimitError:
        return "The AI service is busy right now. Please try again in a moment."
    except anthropic.APIStatusError as e:
        return f"The AI service returned an error, status {e.status_code}."
    except anthropic.APIConnectionError:
        return "I could not reach the AI service. Please check the internet connection."
    if response.stop_reason == "refusal":
        return "I am not able to help with that request."
    answer = " ".join(b.text.strip() for b in response.content if b.type == "text" and b.text.strip())
    if not answer:
        return "I did not get an answer for that."
    HISTORY.append((question, answer))
    del HISTORY[:-MAX_TURNS]
    return answer


def fallback(j, m):
    if not available():
        return Reply("I do not have a built-in answer for that. Say 'search for' followed by your question to look it "
                     "up, or add an AI key to let me answer anything. Say 'help' to see my commands.")
    return Reply(ask(j, m.string))


def explicit(j, m):
    return Reply(ask(j, m.string)) if available() else None


def register(j):
    j.on(r"^(?:ask (?:ai|claude)|analy[sz]e|explain|should i|compare|summari[sz]e|what do you think)\b.+", explicit)


def register_last(j):
    j.on(r".+", fallback)
