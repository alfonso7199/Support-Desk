# Support Triage Desk

**Every customer message, triaged and answered in one place.**

Support Triage Desk reads an incoming support ticket, classifies it, finds the relevant
knowledge-base policy **with citations**, and drafts a ready-to-send reply with a suggested action
— a human agent approves, edits or escalates. Built with the **OpenAI Agents SDK** for the
HCLTech–OpenAI Agentic AI Hackathon (Track 1 — Retail / customer operations; HCL Top-15 case #11).

## The problem

Support teams face backlogs and pressure on first-response time, the biggest driver of CSAT.
Agents hunt the knowledge base and paste policy by hand, and two agents often give two different
answers to the same question.

## What it does

- **Triages** the ticket: intent, category, sentiment, priority, customer/order, missing info.
- **Grounds it in policy**: pulls the relevant KB articles and quotes the exact line that applies.
- **Drafts the reply** the agent will send: on-policy, tone-matched, with a suggested action
  (answer / refund / replace / escalate / ask info) and a confidence.
- **Human in the loop**: edit the reply, then **Send** or **Escalate**; a guardrail flags tickets
  involving money, anger or missing info for review.

## How it works

```
ticket
   └─ TriageAgent → KnowledgeAgent → ReplyAgent → ActionAgent (on decision)
      (intent,       (KB articles      (drafted reply  (send / escalate /
       sentiment,     cited)            + action)        request info)
       priority)                             │
                                             └─► HUMAN: edit · Send · Escalate
```

## Tech stack

- **Backend**: Python, FastAPI, OpenAI Agents SDK; live progress over Server-Sent Events.
- **Frontend**: a custom helpdesk console — an inbox on the left, the conversation thread and an
  editable reply composer on the right (HTML/CSS/JS, no build step).

## Project structure

```
agents_pipeline.py             the agents, models and finalize logic
server.py                      FastAPI app (tickets, process, events/SSE, finalize)
web/                           index.html · style.css · app.js
synthetic_data/tickets/        5 sample tickets
synthetic_data/kb.md           the knowledge base
SupportTriageDesk_pitch.pdf    short pitch deck
```

## Getting started

You need an **OpenAI API key** (platform.openai.com — pay-as-you-go). A ticket costs a few cents.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # set OPENAI_API_KEY
python server.py
```

Open http://127.0.0.1:8050.

## Using it

1. Click a ticket in the inbox (angry refund, shipping delay, login help, double charge, feature
   request). It is triaged automatically.
2. Review the triage chips, the cited knowledge-base articles, and the drafted reply.
3. Edit the reply if needed, add an internal note, then **Send reply** or **Escalate**. The sent
   reply appears in the conversation and the decision is logged to the audit trail.

## Bring your own API key

No key in your `.env`? Click **Add API key** in the top bar and paste your own OpenAI key. It is
stored only in your browser (localStorage) and sent to your local server with each request; the
server falls back to its `.env` key if none is set. Never commit your key to the repo.

## Notes

Tickets, customers and the knowledge base are **synthetic**. The reply is always reviewed by a
human before it is sent.
