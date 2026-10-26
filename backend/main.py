import json
import os
import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI

BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "app.db"
load_dotenv(BASE_DIR / ".env")

MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
client = AsyncOpenAI() if os.getenv("OPENAI_API_KEY") else None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def initialize_database() -> None:
    with sqlite3.connect(DATABASE) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS private_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL CHECK(role IN ('child', 'parent')),
                sender TEXT NOT NULL CHECK(sender IN ('child', 'parent', 'agent')),
                text TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS shared_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_role TEXT NOT NULL CHECK(from_role IN ('child', 'parent')),
                text TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS mediation_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                active INTEGER NOT NULL DEFAULT 0,
                topic TEXT NOT NULL DEFAULT '',
                child_consented INTEGER NOT NULL DEFAULT 0,
                parent_consented INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
        """)
        connection.execute(
            "INSERT OR IGNORE INTO mediation_state (id, active, topic, child_consented, parent_consented, updated_at) VALUES (1, 0, '', 0, 0, ?)",
            (now_iso(),),
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5180"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Local research prototype only: role URLs are not authenticated.
connected_clients: dict[str, set[WebSocket]] = {"child": set(), "parent": set()}


def get_mediation_state() -> dict[str, Any]:
    with sqlite3.connect(DATABASE) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute("SELECT * FROM mediation_state WHERE id = 1").fetchone()
        return dict(row) if row else {"active": 0, "topic": "", "child_consented": 0, "parent_consented": 0}


def update_mediation_state(*, active: int | None = None, topic: str | None = None,
                           child_consented: int | None = None, parent_consented: int | None = None) -> None:
    current = get_mediation_state()
    values = {
        "active": current["active"] if active is None else active,
        "topic": current["topic"] if topic is None else topic,
        "child_consented": current["child_consented"] if child_consented is None else child_consented,
        "parent_consented": current["parent_consented"] if parent_consented is None else parent_consented,
        "updated_at": now_iso(),
    }
    with sqlite3.connect(DATABASE) as connection:
        connection.execute("UPDATE mediation_state SET active=?, topic=?, child_consented=?, parent_consented=?, updated_at=? WHERE id=1",
                           (values["active"], values["topic"], values["child_consented"], values["parent_consented"], values["updated_at"]))


def get_private_messages(role: str) -> list[dict[str, Any]]:
    with sqlite3.connect(DATABASE) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, role, sender, text, timestamp FROM private_messages WHERE role = ? ORDER BY id ASC", (role,)
        ).fetchall()
        return [dict(row) for row in rows]


def get_shared_messages() -> list[dict[str, Any]]:
    with sqlite3.connect(DATABASE) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute("SELECT id, from_role, text, timestamp FROM shared_messages ORDER BY id ASC").fetchall()
        return [dict(row) for row in rows]


def save_private_message(role: str, sender: str, text: str) -> dict[str, Any]:
    timestamp = now_iso()
    with sqlite3.connect(DATABASE) as connection:
        cursor = connection.execute(
            "INSERT INTO private_messages (role, sender, text, timestamp) VALUES (?, ?, ?, ?)",
            (role, sender, text, timestamp),
        )
        message_id = cursor.lastrowid
    return {"id": message_id, "role": role, "sender": sender, "text": text, "timestamp": timestamp}


def save_shared_message(from_role: str, text: str) -> dict[str, Any]:
    timestamp = now_iso()
    with sqlite3.connect(DATABASE) as connection:
        cursor = connection.execute(
            "INSERT INTO shared_messages (from_role, text, timestamp) VALUES (?, ?, ?)", (from_role, text, timestamp)
        )
        message_id = cursor.lastrowid
    return {"id": message_id, "from_role": from_role, "text": text, "timestamp": timestamp}


async def send_to_role(role: str, data: dict[str, Any]) -> None:
    disconnected = []
    for websocket in list(connected_clients[role]):
        try:
            await websocket.send_json(data)
        except Exception:
            disconnected.append(websocket)
    for websocket in disconnected:
        connected_clients[role].discard(websocket)


async def broadcast_shared(message: dict[str, Any]) -> None:
    data = {"type": "shared_message", "message": message}
    await send_to_role("child", data)
    await send_to_role("parent", data)


async def generate_agent_reply(role: str, user_text: str) -> dict[str, Any]:
    empty_result = {"reply": "", "share_draft": "", "start_mediation": False,
                    "mediation_consent": False, "outreach_text": "", "topic": ""}
    if client is None:
        empty_result["reply"] = "The AI agent is not configured yet. Add OPENAI_API_KEY to the backend .env file and restart the server."
        return empty_result

    history = get_private_messages(role)[-16:]
    shared = get_shared_messages()[-10:]
    state = get_mediation_state()
    history_lines = [
        {"role": "user" if item["sender"] == role else "assistant", "content": item["text"]}
        for item in history
    ]
    shared_context = "\n".join(f"{item['from_role']} shared (approved): {item['text']}" for item in shared) or "No approved shared messages yet."
    active_mediation = bool(state["active"])
    topic = state.get("topic", "")

    instructions = f"""You are an active, thoughtful mediator between a child and their parent. You are speaking privately with the {role}. Each participant has their own private conversation with you. Do not reveal the other participant's private chat or quote it verbatim.

YOUR JOB:
- Respond naturally to the current user's message in the JSON field 'reply'.
- When a participant explicitly asks you to tell/contact/inform the other person (e.g. 'please tell my dad'), you should initiate mediation yourself. Do not merely draft a message for the user to copy. Set start_mediation=true and write a short, tactful agent-authored opening in 'outreach_text' for the other participant. The agent should speak in its own voice, e.g. 'Hi, I'd like to talk about a concern that came up...' rather than 'Your child said...'. Briefly summarize the issue without exposing unnecessary private details, and ask for the other person's perspective.
- When mediation is already active, after a relevant response from this participant, create an agent-authored summary in 'outreach_text' to help the other participant understand their perspective and keep the conversation moving. Do not send the user's exact words; paraphrase fairly and briefly. Ask a useful follow-up or offer a balanced possible compromise when appropriate.
- Do not initiate mediation merely because someone mentions the other person. The request to contact them must be clear. Never send highly sensitive or unrelated details.
- If the other participant declines to participate or asks to stop, set mediation_consent=false and leave outreach_text empty. Do not pressure them. If they accept or engage substantively with the issue, set mediation_consent=true. If mediation is active and they continue engaging, continue helping the two sides understand one another.
- The user should be told that during active mediation, the agent may pass along brief paraphrased summaries relevant to the topic; their exact private messages are not forwarded. The user can ask to pause or stop mediation.
- Do not force agreement, assume either person is wrong, or make decisions for the family. Help them explore common ground and retain the right to disagree.
- If the user asks to stop/pause mediation, set mediation_consent=false, leave outreach_text empty, and say you will stop passing summaries along.

CURRENT MEDIATION STATUS: active={active_mediation}; topic={topic or 'not set'}. The current participant is {role}. If mediation is inactive, only set start_mediation=true when this message clearly asks you to contact the other person. If the current participant is the parent receiving the first invitation, treat a substantive answer about the issue as engagement; explicit refusal means no consent.

PRIVACY: The private 'reply' is visible only to the current participant. 'outreach_text', if non-empty, will be delivered by you to the other participant and stored in their own conversation. It must be a safe, minimal paraphrase and must not claim the other person said words they did not say. Do not include the private reply in outreach_text.

Return valid JSON with exactly these keys and types:
- reply: string
- share_draft: string (optional user-approved shared message; usually empty during mediation)
- start_mediation: boolean
- mediation_consent: boolean
- outreach_text: string (empty if nothing should be relayed)
- topic: string (short neutral topic if starting mediation, otherwise empty)"""

    messages = [
        {"role": "system", "content": instructions},
        {"role": "system", "content": f"Approved shared context:\n{shared_context}"},
        *history_lines,
    ]
    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.6,
        )
        parsed = json.loads(response.choices[0].message.content or "{}")
        result = dict(empty_result)
        for key in ("reply", "share_draft", "outreach_text", "topic"):
            value = parsed.get(key, "")
            result[key] = value.strip() if isinstance(value, str) else ""
        result["start_mediation"] = parsed.get("start_mediation") is True
        result["mediation_consent"] = parsed.get("mediation_consent") is True
        result["reply"] = result["reply"][:6000]
        result["share_draft"] = result["share_draft"][:1200]
        result["outreach_text"] = result["outreach_text"][:1600]
        result["topic"] = result["topic"][:200]

        # A simple deterministic stop override protects against the model ignoring a clear request to stop.
        if re.search(r"\b(stop|pause|end) (the )?(mediation|sharing|conversation)\b|don't (share|relay|tell) (anything|my messages)", user_text, re.I):
            result["mediation_consent"] = False
            result["outreach_text"] = ""
            result["reply"] = result["reply"] or "Okay. I'll pause the mediation and won't pass summaries to the other person."
        return result
    except Exception as exc:
        print(f"OpenAI request failed: {exc}")
        empty_result["reply"] = "I couldn't reach the AI service just now. Please check your API key, model access, and backend terminal, then try again."
        return empty_result


@app.get("/")
async def home():
    return {"status": "running", "message": "Parent-child AI mediator backend"}


@app.websocket("/ws/{role}")
async def websocket_endpoint(websocket: WebSocket, role: str):
    if role not in {"child", "parent"}:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    connected_clients[role].add(websocket)
    try:
        await websocket.send_json({
            "type": "history",
            "private_messages": get_private_messages(role),
            "shared_messages": get_shared_messages(),
            "mediation_active": bool(get_mediation_state()["active"]),
        })
        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                continue
            event_type = data.get("type", "message")
            if event_type == "message":
                text = data.get("text", "")
                if not isinstance(text, str):
                    continue
                text = text.strip()
                if not text or len(text) > 4000:
                    continue

                user_message = save_private_message(role, role, text)
                await send_to_role(role, {"type": "private_message", "message": user_message})
                result = await generate_agent_reply(role, text)

                state = get_mediation_state()
                if result["start_mediation"] and not state["active"]:
                    topic = result["topic"] or "A family concern"
                    update_mediation_state(active=1, topic=topic, child_consented=1 if role == "child" else 0,
                                           parent_consented=1 if role == "parent" else 0)
                    state = get_mediation_state()
                elif state["active"]:
                    # Consent/engagement is tracked per participant. The first substantive response to an invitation counts as engagement.
                    consent_field = "child_consented" if role == "child" else "parent_consented"
                    current_consent = bool(state[consent_field])
                    if result["mediation_consent"]:
                        update_mediation_state(**{consent_field: 1})
                    elif role == "parent" and not current_consent and not result["outreach_text"]:
                        # The agent may be handling a refusal; close the mediation if the parent explicitly declines.
                        if re.search(r"\b(no|not interested|don't want|do not want|stop|leave me out)\b", text, re.I):
                            update_mediation_state(active=0, parent_consented=0)
                    elif re.search(r"\b(stop|pause|end) (the )?(mediation|sharing|conversation)\b", text, re.I):
                        update_mediation_state(active=0)

                agent_message = save_private_message(role, "agent", result["reply"] or "I'm here to help you think this through.")
                await send_to_role(role, {"type": "agent_reply", "message": agent_message,
                                          "share_draft": result["share_draft"],
                                          "mediation_active": bool(get_mediation_state()["active"])})

                # An agent-authored message is placed in the other participant's conversation, not forwarded as the user's message.
                state = get_mediation_state()
                outreach = result["outreach_text"]
                may_relay = bool(state["active"] and (state["child_consented"] or role == "child") and (state["parent_consented"] or role == "parent"))
                # The first invitation is allowed because the child explicitly asked the agent to contact the parent.
                if result["start_mediation"] and outreach:
                    target_role = "parent" if role == "child" else "child"
                    target_message = save_private_message(target_role, "agent", outreach)
                    await send_to_role(target_role, {"type": "private_message", "message": target_message, "mediation_notice": True})
                elif outreach and state["active"] and may_relay:
                    target_role = "parent" if role == "child" else "child"
                    target_message = save_private_message(target_role, "agent", outreach)
                    await send_to_role(target_role, {"type": "private_message", "message": target_message, "mediation_notice": True})

            elif event_type == "approve_share":
                text = data.get("text", "")
                if not isinstance(text, str):
                    continue
                text = text.strip()
                if not text or len(text) > 1200:
                    continue
                shared_message = save_shared_message(role, text)
                await broadcast_shared(shared_message)
            elif event_type == "stop_mediation":
                update_mediation_state(active=0)
                await send_to_role("child", {"type": "mediation_status", "active": False})
                await send_to_role("parent", {"type": "mediation_status", "active": False})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"WebSocket error for {role}: {exc}")
    finally:
        connected_clients[role].discard(websocket)
