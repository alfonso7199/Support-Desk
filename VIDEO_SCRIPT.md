# Support Triage Desk — Submission & video script

## Submission form answers (copy/paste)

**Agent workflow.** Support Triage Desk turns an incoming ticket into a triaged, KB-grounded,
ready-to-send reply. (1) **TriageAgent** classifies the ticket: intent, category, sentiment,
priority, customer/order and missing info. (2) **KnowledgeAgent** finds the relevant knowledge-base
articles and **quotes the exact line** that applies, plus a resolution outline. (3) **ReplyAgent**
drafts the customer reply, on-policy and tone-matched, with a suggested action (answer / refund /
replace / escalate / ask info) and a confidence. A human edits and **sends** or **escalates**; an
**Action agent** records the outcome. A guardrail flags tickets involving money, anger or missing
info for review.

**OpenAI technology stack.** OpenAI **Agents SDK** (Agent + Runner) with **structured outputs**
(Pydantic `output_type`); the knowledge base is grounded in-context with citations; live agent
progress streamed over SSE. Default model GPT-4o-mini. Built with **Codex**.

---

## Video script (target 4–5 min)

### Part 1 — Pitch deck (~90 seconds)

- **[Slide 1 — Title]** "Hi, I'm ⟨name⟩. This is **Support Triage Desk** — every customer message,
  triaged and answered in one place. Built with the OpenAI Agents SDK and Codex, for Track 1."
- **[Slide 2 — Problem]** "Support teams face backlogs and pressure on first-response time — the
  biggest driver of CSAT. Agents hunt the knowledge base and paste policy by hand, and two agents
  often give two different answers."
- **[Slide 3 — How it works]** "Here's the **agent workflow**: TriageAgent classifies the ticket,
  KnowledgeAgent finds the policy and **cites the exact KB line**, and ReplyAgent drafts the reply
  with a suggested action. The human edits and sends — with a guardrail on money or anger."
- **[Slide 4 — What the judges see]** "You'll see an inbox, a ticket triaged automatically, the
  cited KB article, and a drafted reply in an editable composer."
- **[Slide 5 — Impact & scale]** "Seconds to a ready, on-policy first reply — consistent across
  agents and fully auditable. It works on any channel and any knowledge base."

### Part 2 — Live demo (~3 minutes)

1. "I open Support Triage Desk at **localhost:8050** — it looks like a helpdesk, inbox on the
   left."
2. "First the key: I click **Add API key**, paste my own OpenAI key — anyone can run the repo. Dot
   turns green."
3. "I click the **angry refund** ticket in the inbox. It triages automatically — no typing."
4. "Watch it: TriageAgent, then KnowledgeAgent, then ReplyAgent."
5. "Here's the result. The **triage chips** show intent, sentiment, priority — see it flagged this
   one **urgent** and **angry**. The **knowledge base panel cites the exact policy line** about
   refunds. And the **drafted reply** is ready in the composer, with a suggested action."
6. "Because it involves money and anger, it's flagged **needs review** — the guardrail. I edit the
   reply, add an internal note, and click **Send** — the reply appears in the conversation and it's
   logged in the audit trail. Or I **Escalate**."
7. "Let me click the **double-charge** ticket to show a clean refund case. That's Support Triage
   Desk — every customer answered, fast and on-policy."
