import React from 'react';
import { useEffect, useRef, useState } from "react";
import "./App.css";

const BACKEND_URL = "ws://localhost:8000";

export default function App() {
  const role = window.location.pathname.startsWith("/parent")
    ? "parent"
    : "child";

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(false);

  const socketRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const socket = new WebSocket(`${BACKEND_URL}/ws/${role}`);

    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "history") {
        setMessages(data.messages);
      }

      if (data.type === "message") {
        setMessages((previous) => [
          ...previous,
          data.message,
        ]);
      }
    };

    socket.onclose = () => {
      setConnected(false);
    };

    socket.onerror = () => {
      setConnected(false);
    };

    return () => {
      socket.close();
    };
  }, [role]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  function sendMessage(event) {
    event.preventDefault();

    const trimmedText = text.trim();

    if (!trimmedText) return;

    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      alert("Not connected to the server yet. Please try again.");
      return;
    }

    socket.send(JSON.stringify({
      text: trimmedText,
    }));

    setText("");
  }

  const isChild = role === "child";

  return (
    <main className="app">
      <header className="header">
        <div>
          <p className="eyebrow">FAMILY CONVERSATION</p>

          <h1>
            {isChild ? "Child space" : "Parent space"}
          </h1>

          <p className="subtitle">
            {isChild
              ? "Ask questions and understand your parent's perspective."
              : "Listen to your child's questions and explain your perspective."}
          </p>
        </div>

        <div className={`connection ${connected ? "online" : ""}`}>
          <span className="status-dot" />
          {connected ? "Connected" : "Connecting..."}
        </div>
      </header>

      <section className="conversation">
        <div className="conversation-heading">
          <h2>Conversation</h2>
          <span>Live messages</span>
        </div>

        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">↗</div>

            <h3>Start a conversation</h3>

            <p>
              {isChild
                ? "Ask your parent about a post, a concern, or a decision."
                : "When your child sends a message, it will appear here."}
            </p>
          </div>
        )}

        <div className="messages">
          {messages.map((message) => {
            const ownMessage = message.sender === role;

            return (
              <article
                key={message.id}
                className={`message-row ${
                  ownMessage ? "own-row" : "other-row"
                }`}
              >
                <div className="message-content">
                  <div className="message-author">
                    {message.sender === "child"
                      ? "Child"
                      : "Parent"}
                  </div>

                  <div className="message-bubble">
                    {message.text}
                  </div>

                  <time className="message-time">
                    {new Date(message.timestamp).toLocaleTimeString(
                      [],
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )}
                  </time>
                </div>
              </article>
            );
          })}

          <div ref={bottomRef} />
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              isChild
                ? "Ask your parent a question..."
                : "Write your response..."
            }
            maxLength={4000}
            disabled={!connected}
          />

          <button
            type="submit"
            disabled={!connected || !text.trim()}
          >
            Send ↗
          </button>
        </form>

        <p className="footer-note">
          {connected
            ? "Messages appear on both screens automatically."
            : "Connecting to the server. Check that the backend is running."}
        </p>
      </section>
    </main>
  );
}