import json
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware


DATABASE = "app.db"


def initialize_database():
    with sqlite3.connect(DATABASE) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
        """)


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Keep track of connected browser tabs.
connected_clients: set[WebSocket] = set()


def get_messages():
    with sqlite3.connect(DATABASE) as connection:
        connection.row_factory = sqlite3.Row

        rows = connection.execute(
            """
            SELECT id, sender, text, timestamp
            FROM messages
            ORDER BY id ASC
            """
        ).fetchall()

        return [dict(row) for row in rows]


def save_message(sender: str, text: str):
    timestamp = datetime.now(timezone.utc).isoformat()

    with sqlite3.connect(DATABASE) as connection:
        cursor = connection.execute(
            """
            INSERT INTO messages (sender, text, timestamp)
            VALUES (?, ?, ?)
            """,
            (sender, text, timestamp),
        )

        message_id = cursor.lastrowid

    return {
        "id": message_id,
        "sender": sender,
        "text": text,
        "timestamp": timestamp,
    }


async def broadcast(data: dict):
    disconnected = []

    for client in list(connected_clients):
        try:
            await client.send_json(data)
        except Exception:
            disconnected.append(client)

    for client in disconnected:
        connected_clients.discard(client)


@app.get("/")
async def home():
    return {
        "status": "running",
        "message": "Parent-child communication backend",
    }


@app.websocket("/ws/{role}")
async def websocket_endpoint(websocket: WebSocket, role: str):
    if role not in {"child", "parent"}:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    connected_clients.add(websocket)

    try:
        # Send existing conversation history to the new connection.
        await websocket.send_json({
            "type": "history",
            "messages": get_messages(),
        })

        while True:
            data = await websocket.receive_json()

            text = data.get("text", "")

            if not isinstance(text, str):
                continue

            text = text.strip()

            if not text or len(text) > 4000:
                continue

            # The role comes from the connection, not the message.
            message = save_message(role, text)

            # Deliver the new message to every connected browser.
            await broadcast({
                "type": "message",
                "message": message,
            })

    except WebSocketDisconnect:
        pass

    finally:
        connected_clients.discard(websocket)