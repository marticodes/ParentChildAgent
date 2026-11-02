
import React, { useEffect, useState } from "react";
import "./ParentEvaluation.css";

const DB_NAME = "parentChildEvaluation";
const STORE_NAME = "datasets";

const VALUE_OPTIONS = [
  "Achievement",
  "Belonging",
  "Popularity",
  "Appearance",
  "Competition",
  "Self-expression",
  "Discipline",
  "Creativity",
  "Consumerism",
  "Social connection",
  "Other",
  "Not sure",
];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getDataset() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get("current");

    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function getParentResponses() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get("parentResponses");

    request.onsuccess = () => {
      db.close();
      resolve(request.result || {});
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function saveParentResponses(responses) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(responses, "parentResponses");

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export default function ParentEvaluation() {
  const [posts, setPosts] = useState([]);
  const [responses, setResponses] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [screen, setScreen] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        const dataset = await getDataset();
        const savedResponses = await getParentResponses();

        if (!dataset || !dataset.posts || dataset.posts.length === 0) {
          setError("No posts have been uploaded yet. Please contact the researcher.");
          setScreen("error");
          return;
        }

        setPosts(dataset.posts);
        setResponses(savedResponses);

        const firstIncomplete = dataset.posts.findIndex(
          (post) => !savedResponses[post.id]
        );

        if (firstIncomplete === -1) {
          setScreen("complete");
        } else {
          setCurrentIndex(firstIncomplete);
          setScreen("welcome");
        }
      } catch (err) {
        console.error(err);
        setError("We couldn't load the evaluation. Please try again.");
        setScreen("error");
      }
    }

    loadData();
  }, []);

  const currentPost = posts[currentIndex];
  const currentResponse = currentPost
    ? responses[currentPost.id] || {}
    : {};

  async function updateResponse(field, value) {
    const updatedResponses = {
      ...responses,
      [currentPost.id]: {
        ...currentResponse,
        post_id: currentPost.id,
        [field]: value,
      },
    };

    setResponses(updatedResponses);
    await saveParentResponses(updatedResponses);
  }

  function toggleValue(value) {
    const selected = currentResponse.perceived_values || [];

    let updated;
    if (selected.includes(value)) {
      updated = selected.filter((item) => item !== value);
    } else {
      updated = [...selected, value];
    }

    updateResponse("perceived_values", updated);
  }

  function isCurrentPostComplete() {
    return (
      Array.isArray(currentResponse.perceived_values) &&
      currentResponse.perceived_values.length > 0 &&
      currentResponse.comfort_rating !== undefined &&
      currentResponse.content_preference &&
      currentResponse.discussion_interest
    );
  }

  function handleNext() {
    if (!isCurrentPostComplete()) {
      alert("Please answer all required questions before continuing.");
      return;
    }

    if (currentIndex < posts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setScreen("complete");
    }
  }

  function handleBack() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else {
      setScreen("welcome");
    }
  }

  const progress = posts.length
    ? ((currentIndex + (screen === "complete" ? 1 : 0)) / posts.length) * 100
    : 0;

  if (screen === "loading") {
    return <div className="parent-container">Loading evaluation...</div>;
  }

  if (screen === "error") {
    return (
      <div className="parent-container">
        <div className="parent-card">
          <h1>Something went wrong</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (screen === "welcome") {
    return (
      <div className="parent-container">
        <div className="parent-card welcome-card">
          <div className="parent-icon">💬</div>
          <h1>Parent Evaluation</h1>
          <p>
            Thank you for participating. You will be shown a series of
            social-media-style posts.
          </p>
          <p>
            Please share your perspective on the messages and values they
            communicate. There are no objectively correct answers; we are
            interested in your interpretation.
          </p>
          <p className="parent-small-text">
            Your answers are saved automatically as you progress.
          </p>
          <button
            className="parent-primary-button"
            onClick={() => setScreen("evaluation")}
          >
            Start evaluation
          </button>
        </div>
      </div>
    );
  }

  if (screen === "complete") {
    return (
      <div className="parent-container">
        <div className="parent-card completion-card">
          <div className="parent-icon">✓</div>
          <h1>Thank you!</h1>
          <p>
            You have completed the evaluation. Your responses have been saved.
          </p>
          <p className="parent-small-text">
            You may now close this page.
          </p>
        </div>
      </div>
    );
  }

  if (!currentPost) return null;

  return (
    <div className="parent-container">
      <div className="parent-evaluation-wrapper">
        <header className="parent-header">
          <span>Parent Evaluation</span>
          <span>
            Post {currentIndex + 1} of {posts.length}
          </span>
        </header>

        <div className="parent-progress-track">
          <div
            className="parent-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        <main className="parent-card parent-question-card">
          <div className="parent-post">
            {currentPost.image && (
              <img
                src={currentPost.image}
                alt="Social media post"
                className="parent-post-image"
              />
            )}
            <p className="parent-post-caption">{currentPost.caption}</p>
          </div>

          <div className="parent-divider" />

          <section className="parent-question">
            <h2>1. What values do you think this post communicates?</h2>
            <p className="parent-instruction">
              Select all that apply.
            </p>

            <div className="parent-options-grid">
              {VALUE_OPTIONS.map((value) => (
                <label className="parent-checkbox-option" key={value}>
                  <input
                    type="checkbox"
                    checked={(currentResponse.perceived_values || []).includes(value)}
                    onChange={() => toggleValue(value)}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </section>

          <div className="parent-divider" />

          <section className="parent-question">
            <h2>2. How comfortable would you feel with your child viewing this content?</h2>
            <div className="parent-choice-list">
              {[
                [1, "Very uncomfortable"],
                [2, "Somewhat uncomfortable"],
                [3, "Neither comfortable nor uncomfortable"],
                [4, "Somewhat comfortable"],
                [5, "Very comfortable"],
              ].map(([value, label]) => (
                <label className="parent-radio-option" key={value}>
                  <input
                    type="radio"
                    name="comfort"
                    checked={currentResponse.comfort_rating === value}
                    onChange={() => updateResponse("comfort_rating", value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </section>

          <div className="parent-divider" />

          <section className="parent-question">
            <h2>3. Would you prefer your child to see this type of content...</h2>
            <div className="parent-choice-list">
              {[
                ["less", "Less often"],
                ["same", "About the same amount"],
                ["more", "More often"],
              ].map(([value, label]) => (
                <label className="parent-radio-option" key={value}>
                  <input
                    type="radio"
                    name="content-preference"
                    checked={currentResponse.content_preference === value}
                    onChange={() => updateResponse("content_preference", value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </section>

          <div className="parent-divider" />

          <section className="parent-question">
            <h2>4. Would you be interested in discussing this post with your child?</h2>
            <div className="parent-choice-list">
              {[
                ["yes", "Yes"],
                ["maybe", "Maybe"],
                ["no", "No"],
              ].map(([value, label]) => (
                <label className="parent-radio-option" key={value}>
                  <input
                    type="radio"
                    name="discussion"
                    checked={currentResponse.discussion_interest === value}
                    onChange={() => updateResponse("discussion_interest", value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            {(currentResponse.discussion_interest === "yes" ||
              currentResponse.discussion_interest === "maybe") && (
              <div className="parent-note-area">
                <label htmlFor="discussion-note">
                  Would you like to explain why? (Optional)
                </label>
                <textarea
                  id="discussion-note"
                  rows="3"
                  placeholder="Write your thoughts here..."
                  value={currentResponse.discussion_note || ""}
                  onChange={(e) =>
                    updateResponse("discussion_note", e.target.value)
                  }
                />
              </div>
            )}
          </section>

          <div className="parent-navigation">
            <button
              className="parent-secondary-button"
              onClick={handleBack}
            >
              Back
            </button>
            <button
              className="parent-primary-button"
              onClick={handleNext}
            >
              {currentIndex === posts.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
