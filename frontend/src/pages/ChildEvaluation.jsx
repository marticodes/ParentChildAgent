
import React, { useEffect, useState } from "react";
import "./ChildEvaluation.css";

const DB_NAME = "parentChildEvaluation";
const STORE_NAME = "datasets";

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

async function saveChildResponses(responses) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(responses, "childResponses");

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

async function getChildResponses() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get("childResponses");

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

const ratingLabels = [
  "Not at all",
  "A little",
  "It's okay",
  "I like it",
  "I like it a lot",
];

export default function ChildEvaluation() {
  const [posts, setPosts] = useState([]);
  const [responses, setResponses] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [screen, setScreen] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        const dataset = await getDataset();

        if (!dataset || !dataset.posts?.length) {
          setError("No posts have been uploaded yet. Please ask the researcher to upload the posts first.");
          setScreen("error");
          return;
        }

        const savedResponses = await getChildResponses();

        setPosts(dataset.posts);
        setResponses(savedResponses);

        const firstIncomplete = dataset.posts.findIndex(
          (post) => !savedResponses[post.id]
        );

        setCurrentIndex(
          firstIncomplete === -1 ? dataset.posts.length - 1 : firstIncomplete
        );

        setScreen(
          dataset.posts.every((post) => savedResponses[post.id])
            ? "complete"
            : "welcome"
        );
      } catch (err) {
        console.error(err);
        setError("We couldn't load the posts. Please refresh the page.");
        setScreen("error");
      }
    }

    loadData();
  }, []);

  const currentPost = posts[currentIndex];
  const currentResponse = currentPost
    ? responses[currentPost.id] || {}
    : {};

  const completedCount = posts.filter(
    (post) => responses[post.id]
  ).length;

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
    await saveChildResponses(updatedResponses);
  }

  async function handleNext() {
    if (
      !currentResponse.like_rating ||
      !currentResponse.wants_more
    ) {
      return;
    }

    if (currentIndex === posts.length - 1) {
      setScreen("complete");
    } else {
      setCurrentIndex((index) => index + 1);
    }
  }

  function handleBack() {
    if (currentIndex > 0) {
      setCurrentIndex((index) => index - 1);
    }
  }

  if (screen === "loading") {
    return <div className="child-page"><p>Loading posts...</p></div>;
  }

  if (screen === "error") {
    return (
      <div className="child-page">
        <div className="child-panel">
          <h2>Oops!</h2>
          <p>{error}</p>
          <a href="/evaluation/developer">Back to dashboard</a>
        </div>
      </div>
    );
  }

  if (screen === "welcome") {
    return (
      <div className="child-page">
        <div className="child-panel welcome-panel">
          <div className="child-emoji">✨</div>
          <h1>Let's explore!</h1>
          <p>
            Explore these posts and tell us what you think.
            There are no right or wrong answers.
            We want to understand what you enjoy!
          </p>
          <p className="child-small">
            You'll see {posts.length} posts, one at a time.
          </p>
          <button onClick={() => setScreen("evaluation")}>
            Start exploring
          </button>
        </div>
      </div>
    );
  }

  if (screen === "complete") {
    return (
      <div className="child-page">
        <div className="child-panel completion-panel">
          <div className="child-emoji">🎉</div>
          <h1>You're all done!</h1>
          <p>Thank you for exploring all the posts and sharing your opinions!</p>
          <p className="child-small">
            You evaluated {posts.length} posts.
          </p>
          <a href="/evaluation/developer">Return to dashboard</a>
        </div>
      </div>
    );
  }

  return (
    <div className="child-page">
      <div className="child-container">
        <header className="child-header">
          <div>
            <span className="child-brand">✨ Explore</span>
            <p>Tell us what you think!</p>
          </div>
          <span className="child-progress-text">
            {currentIndex + 1} of {posts.length}
          </span>
        </header>

        <div className="child-progress-track">
          <div
            className="child-progress-fill"
            style={{
              width: `${((currentIndex + 1) / posts.length) * 100}%`,
            }}
          />
        </div>

        <main className="child-card">
          <div className="child-post-image">
            <img
              src={currentPost.image}
              alt={`Post ${currentIndex + 1}`}
            />
          </div>

          {currentPost.caption && (
            <p className="child-caption">{currentPost.caption}</p>
          )}

          <section className="child-question">
            <h2>How much do you like this post?</h2>

            <div className="child-rating-options">
              {ratingLabels.map((label, index) => {
                const rating = index + 1;

                return (
                  <button
                    key={rating}
                    className={`child-rating ${
                      currentResponse.like_rating === rating
                        ? "selected"
                        : ""
                    }`}
                    onClick={() => updateResponse("like_rating", rating)}
                    aria-label={`${rating}: ${label}`}
                  >
                    <span>❤️</span>
                    <small>{rating}</small>
                  </button>
                );
              })}
            </div>

            {currentResponse.like_rating && (
              <p className="child-selected-label">
                {ratingLabels[currentResponse.like_rating - 1]}
              </p>
            )}
          </section>

          <section className="child-question">
            <h2>Would you like to see more posts like this?</h2>

            <div className="child-choice-options">
              {[
                { value: "yes", label: "Yes", emoji: "😊" },
                { value: "not sure", label: "Not sure", emoji: "🤔" },
                { value: "no", label: "No", emoji: "🙅" },
              ].map((option) => (
                <button
                  key={option.value}
                  className={`child-choice ${
                    currentResponse.wants_more === option.value
                      ? "selected"
                      : ""
                  }`}
                  onClick={() => updateResponse("wants_more", option.value)}
                >
                  <span>{option.emoji}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <footer className="child-navigation">
            <button
              className="child-back-button"
              onClick={handleBack}
              disabled={currentIndex === 0}
            >
              Back
            </button>

            <span className="child-completed">
              {completedCount} / {posts.length} answered
            </span>

            <button
              className="child-next-button"
              onClick={handleNext}
              disabled={
                !currentResponse.like_rating ||
                !currentResponse.wants_more
              }
            >
              {currentIndex === posts.length - 1
                ? "Finish"
                : "Next"}
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}
