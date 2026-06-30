"""
Support Triage Desk - turn an incoming customer message into a triaged, KB-grounded,
ready-to-send reply with a suggested action. Built with the OpenAI Agents SDK.

  TriageAgent     -> intent, category, sentiment, priority, customer, gaps
  KnowledgeAgent  -> relevant KB articles (cited) + a resolution outline
  ReplyAgent      -> the drafted customer reply + suggested action + confidence

Synthetic tickets and knowledge base. Illustrative only.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from agents import Agent, Runner

load_dotenv()

MODEL = os.getenv("SUPPORT_MODEL", "gpt-4o-mini")
ROOT = Path(__file__).parent
KB_PATH = ROOT / "synthetic_data" / "kb.md"


def _kb_text() -> str:
    try:
        return KB_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class Triage(BaseModel):
    customer_name: Optional[str] = None
    order_id: Optional[str] = None
    channel: Optional[str] = Field(default=None, description="email | chat | phone")
    intent: str = Field(description="Short label, e.g. 'Refund request'")
    category: str = Field(description="Returns | Shipping | Billing | How-to | Account | Product | Other")
    sentiment: str = Field(description="positive | neutral | negative | angry")
    priority: str = Field(description="urgent | high | normal | low")
    summary: str
    missing_info: list[str] = Field(default_factory=list)


class KBHit(BaseModel):
    id: str
    title: str
    quote: str = Field(description="Short verbatim line from the KB article that applies")


class Knowledge(BaseModel):
    kb_hits: list[KBHit] = Field(default_factory=list)
    resolution_outline: str = Field(description="How policy says this should be resolved")


class Resolution(BaseModel):
    suggested_action: str = Field(description="answer | refund | replace | escalate | ask_info")
    confidence: float = Field(ge=0.0, le=1.0)
    reply_subject: str
    reply_message: str = Field(description="Customer-facing reply, friendly and on-policy")
    internal_note: str = Field(description="Short note for the agent / next handler")
    requires_human_review: bool = False


class Finalization(BaseModel):
    decision: str = Field(description="approved | rejected")
    action: str = Field(description="reply_sent | escalated | info_requested")
    action_summary: str
    next_steps: list[str] = Field(default_factory=list)


@dataclass
class AuditEntry:
    timestamp: str
    agent: str
    summary: str


@dataclass
class TicketResult:
    triage: Triage
    knowledge: Knowledge
    resolution: Resolution
    audit_log: list[AuditEntry] = field(default_factory=list)


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------
def build_triage_agent() -> Agent:
    return Agent(
        name="TriageAgent",
        model=MODEL,
        instructions=(
            "You triage an incoming customer support message. Extract the customer "
            "name, order id and channel if present; classify the intent, category, "
            "sentiment and priority (urgent if money/angry/at-risk, else high/normal/"
            "low); write a one-line summary; and list any info missing to resolve it."
        ),
        output_type=Triage,
    )


def build_knowledge_agent() -> Agent:
    return Agent(
        name="KnowledgeAgent",
        model=MODEL,
        instructions=(
            "You are a support knowledge assistant. Using ONLY the knowledge base "
            "provided, pick the articles relevant to the ticket and quote the exact "
            "line that applies (id + title + quote). Then give a short resolution "
            "outline of what policy says should happen. If nothing applies, say so."
        ),
        output_type=Knowledge,
    )


def build_reply_agent() -> Agent:
    return Agent(
        name="ReplyAgent",
        model=MODEL,
        instructions=(
            "You draft the customer reply for a support agent to review. Be warm, "
            "concise and on-policy, matching the customer's urgency. Ground the reply "
            "in the KB outline; do not invent policy. Choose a suggested action "
            "(answer/refund/replace/escalate/ask_info), a confidence, a subject, the "
            "reply message, and a short internal note. If the action involves money or "
            "the sentiment is angry or info is missing, set requires_human_review=true."
        ),
        output_type=Resolution,
    )


def build_action_agent() -> Agent:
    return Agent(
        name="ActionAgent",
        model=MODEL,
        instructions=(
            "A support agent has made a decision on a drafted reply. If approved and "
            "the action asks for info, action=info_requested; if approved and action is "
            "escalate, action=escalated; otherwise approved -> reply_sent. If rejected, "
            "action=escalated. Give a short action_summary and 2-4 next steps. Honor any "
            "agent note."
        ),
        output_type=Finalization,
    )


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------
async def run_pipeline(
    ticket_text: str,
    on_progress: Optional[Callable[[str, str], None]] = None,
) -> TicketResult:
    def notify(agent: str, status: str) -> None:
        if on_progress:
            on_progress(agent, status)

    audit: list[AuditEntry] = []

    notify("TriageAgent", "Classifying the ticket...")
    triage: Triage = (await Runner.run(build_triage_agent(), input=ticket_text)).final_output
    audit.append(AuditEntry(_now(), "TriageAgent", f"{triage.category} · {triage.sentiment} · {triage.priority}"))

    notify("KnowledgeAgent", "Searching the knowledge base...")
    knowledge: Knowledge = (await Runner.run(
        build_knowledge_agent(),
        input=f"KNOWLEDGE BASE:\n{_kb_text()}\n\nTICKET:\n{ticket_text}",
    )).final_output
    audit.append(AuditEntry(_now(), "KnowledgeAgent", f"{len(knowledge.kb_hits)} KB article(s) cited"))

    notify("ReplyAgent", "Drafting the reply...")
    resolution: Resolution = (await Runner.run(
        build_reply_agent(),
        input=(
            "TRIAGE:\n" + triage.model_dump_json()
            + "\n\nKB OUTLINE:\n" + knowledge.model_dump_json()
            + "\n\nORIGINAL TICKET:\n" + ticket_text
        ),
    )).final_output
    if resolution.confidence < 0.7:
        resolution.requires_human_review = True
    audit.append(AuditEntry(_now(), "ReplyAgent", f"action={resolution.suggested_action}; confidence={resolution.confidence:.2f}"))

    notify("Manager", "Reply ready for agent review.")
    return TicketResult(triage=triage, knowledge=knowledge, resolution=resolution, audit_log=audit)


async def finalize_ticket(triage: dict, resolution: dict, decision: str, edited_reply: str = "", note: str = "") -> Finalization:
    agent = build_action_agent()
    blocks = [f"DECISION: {decision}", "TRIAGE:\n" + json.dumps(triage, ensure_ascii=False),
              "RESOLUTION:\n" + json.dumps(resolution, ensure_ascii=False)]
    if edited_reply.strip():
        blocks.append("FINAL REPLY (edited by agent):\n" + edited_reply)
    if note.strip():
        blocks.append("AGENT NOTE:\n" + note)
    return (await Runner.run(agent, input="\n\n".join(blocks))).final_output
