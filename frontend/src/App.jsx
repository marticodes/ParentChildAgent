import React, { useEffect, useRef, useState } from "react";
import "./App.css";

const BACKEND_URL = "ws://localhost:8000";

export default function App() {
  const role = window.location.pathname.startsWith("/parent") ? "parent" : "child";
  const isChild = role === "child";
  const [messages, setMessages] = useState([]);
  const [sharedMessages, setSharedMessages] = useState([]);
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(false);
  const [pendingDraft, setPendingDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [mediationActive, setMediationActive] = useState(false);
  const socketRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const socket = new WebSocket(`${BACKEND_URL}/ws/${role}`);
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "history") {
        setMessages(data.private_messages || []);
        setSharedMessages(data.shared_messages || []);
        setMediationActive(Boolean(data.mediation_active));
        setBusy(false);
      }
      if (data.type === "private_message") {
        setMessages((previous) => previous.some((m) => m.id === data.message.id) ? previous : [...previous, data.message]);
        if (data.message.sender === role) setBusy(true);
      }
      if (data.type === "agent_reply") {
        setMessages((previous) => previous.some((m) => m.id === data.message.id) ? previous : [...previous, data.message]);
        setPendingDraft(data.share_draft || "");
        setBusy(false);
      }
      if (data.type === "shared_message") {
        setSharedMessages((previous) => previous.some((m) => m.id === data.message.id) ? previous : [...previous, data.message]);
      }
      if (data.type === "mediation_status") setMediationActive(Boolean(data.active));
    };
    socket.onclose = () => { setConnected(false); setBusy(false); };
    socket.onerror = () => setConnected(false);
    return () => { socket.close(); };
  }, [role]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sharedMessages]);

  function sendMessage(event) {
    event.preventDefault();
    const trimmedText = text.trim();
    const socket = socketRef.current;
    if (!trimmedText || !socket || socket.readyState !== WebSocket.OPEN || busy) return;
    socket.send(JSON.stringify({ type: "message", text: trimmedText }));
    setText("");
    setPendingDraft("");
    setBusy(true);
  }

  function stopMediation() {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "stop_mediation" }));
    setMediationActive(false);
  }

  function approveDraft() {
    const socket = socketRef.current;
    if (!pendingDraft.trim() || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "approve_share", text: pendingDraft.trim() }));
    setPendingDraft("");
  }

  const timeLabel = (timestamp) => new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <main className="app">
      <header className="header">
        <div>
          <p className="eyebrow">FAMILY CONVERSATION</p>
          <h1>{isChild ? "Child space" : "Parent space"}</h1>
          <p className="subtitle">
            Talk privately with your AI guide. When you ask it to mediate, it can contact the other person in its own voice.
          </p>
        </div>
        <div className={`connection ${connected ? "online" : ""}`}>
          <span className="status-dot" />{connected ? "Connected" : "Connecting..."}
        </div>
      </header>

      {mediationActive && (
        <div className="share-card mediation-banner">
          <p className="eyebrow">MEDIATION IN PROGRESS</p>
          <p>Your AI guide may pass brief, relevant summaries of each person's perspective to help the conversation move forward. It does not forward exact private messages.</p>
          <button type="button" className="secondary-button" onClick={stopMediation}>Pause mediation</button>
        </div>
      )}

      <section className="conversation">
        <div className="conversation-heading">
          <h2>Your conversation with your AI guide</h2><span>Private unless mediation is active</span>
        </div>
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">✦</div>
            <h3>Start with your AI guide</h3>
            <p>{isChild ? "Describe a situation, concern, or question you would like help thinking through." : "Share what you are concerned about or what you would like your child to understand."}</p>
          </div>
        )}
        <div className="messages">
          {messages.map((message) => {
            const ownMessage = message.sender === role;
            const agentMessage = message.sender === "agent";
            return (
              <article key={`${message.role}-${message.id}`} className={`message-row ${ownMessage ? "own-row" : "other-row"}`}>
                <div className="message-content">
                  <div className="message-author">{agentMessage ? "Your AI guide" : ownMessage ? "You" : message.sender}</div>
                  <div className="message-bubble">{message.text}</div>
                  <time className="message-time">{timeLabel(message.timestamp)}</time>
                </div>
              </article>
            );
          })}
          {busy && <div className="mediator-status">Your AI guide is thinking…</div>}
          <div ref={bottomRef} />
        </div>

        {pendingDraft && (
          <div className="share-card">
            <p className="eyebrow">OPTIONAL MESSAGE TO SHARE</p>
            <p className="share-explanation">Your AI guide suggests this message. It will stay private unless you choose to share it.</p>
            <textarea value={pendingDraft} onChange={(event) => setPendingDraft(event.target.value)} maxLength={1200} aria-label="Edit proposed message to share" />
            <div className="share-actions">
              <button type="button" className="secondary-button" onClick={() => setPendingDraft("")}>Keep private</button>
              <button type="button" onClick={approveDraft} disabled={!connected || !pendingDraft.trim()}>Approve & share</button>
            </div>
          </div>
        )}

        <form className="composer" onSubmit={sendMessage}>
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder={isChild ? "Talk to your AI guide..." : "Talk to your AI guide..."} maxLength={4000} disabled={!connected || busy} />
          <button type="submit" disabled={!connected || busy || !text.trim()}>{busy ? "Thinking…" : "Send ↗"}</button>
        </form>
        <p className="footer-note">Your exact private messages are not forwarded. If you ask the agent to mediate and the other person engages, it may share brief paraphrased summaries about the topic. You can ask it to pause mediation at any time. Optional shared messages still require your approval.</p>
      </section>
    </main>
  );
}
