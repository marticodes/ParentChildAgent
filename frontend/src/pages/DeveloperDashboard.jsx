
import React, { useEffect, useState } from "react";
import JSZip from "jszip";
import "./DeveloperDashboard.css";

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

async function getEntry(key) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);

    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function saveEntry(key, value) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);

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

async function deleteEntry(key) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);

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

async function clearStudyData() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.delete("current");
    store.delete("childResponses");
    store.delete("parentResponses");

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

async function fileToDataURL(file, mimeType = "image/png") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image."));

    const typedBlob = new Blob([file], { type: mimeType });
    reader.readAsDataURL(typedBlob);
  });
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = Array.isArray(value)
    ? value.join("; ")
    : value == null
      ? ""
      : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

export default function DeveloperDashboard() {
  const [dataset, setDataset] = useState(null);
  const [childResponses, setChildResponses] = useState({});
  const [parentResponses, setParentResponses] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [savedDataset, savedChild, savedParent] = await Promise.all([
          getEntry("current"),
          getEntry("childResponses"),
          getEntry("parentResponses"),
        ]);

        setDataset(savedDataset);
        setChildResponses(savedChild || {});
        setParentResponses(savedParent || {});
      } catch (err) {
        console.error(err);
        setError("Could not load the saved study data.");
      }
    }

    loadDashboard();
  }, []);

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (!file.name.toLowerCase().endsWith(".zip")) {
        throw new Error("Please upload a ZIP file.");
      }

      const zip = await JSZip.loadAsync(file);
      const preparedPosts = [];

      // FORMAT 1: posts.json and associated images
      const metadataFile = zip.file("posts.json");

      if (metadataFile) {
        const metadata = JSON.parse(await metadataFile.async("text"));

        if (!Array.isArray(metadata.posts) || !metadata.posts.length) {
          throw new Error("posts.json must contain a non-empty posts array.");
        }

        for (const post of metadata.posts) {
          if (!post.id || !post.image) {
            throw new Error("Every post needs an ID and image path.");
          }

          const imagePath = post.image
            .replace(/\\/g, "/")
            .replace(/^\.\/+/, "");

          if (
            imagePath.startsWith("/") ||
            imagePath.split("/").includes("..")
          ) {
            throw new Error(`Invalid image path for ${post.id}.`);
          }

          const imageFile = zip.file(imagePath);

          if (!imageFile || imageFile.dir) {
            throw new Error(`Image not found: ${post.image}`);
          }

          const imageBlob = await imageFile.async("blob");

          preparedPosts.push({
            id: post.id,
            image: await fileToDataURL(
              imageBlob,
              post.image.toLowerCase().endsWith(".jpg") ||
              post.image.toLowerCase().endsWith(".jpeg")
                ? "image/jpeg"
                : post.image.toLowerCase().endsWith(".webp")
                  ? "image/webp"
                  : "image/png"
            ),
            caption: post.caption || "",
            description: post.description || "",
            intent: post.intent || "",
            values: Array.isArray(post.values) ? post.values : [],
            topic: post.topic || "",
          });
        }
      } else {
        // FORMAT 2A: one post in the ZIP root
        const rootImage = zip.file("post.png");

        if (rootImage) {
          const captionFile = zip.file("caption.txt");
          const imageBlob = await rootImage.async("blob");

          const caption = captionFile
            ? (await captionFile.async("text")).trim()
            : "";

          preparedPosts.push({
            id: "post_001",
            image: await fileToDataURL(imageBlob, "image/png"),
            caption,
            description: "",
            intent: "",
            values: [],
            topic: "",
          });
        } else {
          // FORMAT 2B: one folder per post
          const folders = new Set();

          Object.keys(zip.files).forEach((path) => {
            if (/\/post\.png$/i.test(path)) {
              folders.add(path.slice(0, path.lastIndexOf("/")));
            }
          });

          if (folders.size === 0) {
            throw new Error(
              "No posts found. Include post.png and caption.txt in the ZIP root or in individual post folders."
            );
          }

          for (const folder of [...folders].sort()) {
            const imageFile = zip.file(`${folder}/post.png`);
            const captionFile = zip.file(`${folder}/caption.txt`);

            if (!imageFile || imageFile.dir) continue;

            const imageBlob = await imageFile.async("blob");

            if (!imageBlob.type.startsWith("image/")) {
              throw new Error(`${folder}/post.png is not a valid image.`);
            }

            const caption = captionFile
              ? (await captionFile.async("text")).trim()
              : "";

            preparedPosts.push({
              id: folder.split("/").pop(),
              image: await fileToDataURL(imageBlob, "image/png"),
              caption,
              description: "",
              intent: "",
              values: [],
              topic: "",
            });
          }
        }
      }

      if (preparedPosts.length === 0) {
        throw new Error("No valid posts were found.");
      }

      const ids = preparedPosts.map((post) => post.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("Each post must have a unique ID.");
      }

      const newDataset = {
        posts: preparedPosts,
        uploadedAt: new Date().toISOString(),
        fileName: file.name,
      };

      // A new dataset starts a fresh evaluation.
      await clearStudyData();
      await saveEntry("current", newDataset);

      setDataset(newDataset);
      setChildResponses({});
      setParentResponses({});
      setSuccess(`${preparedPosts.length} posts successfully imported. Previous responses were cleared.`);
    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong while importing.");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  async function updatePost(postId, field, value) {
    const updatedPosts = dataset.posts.map((post) =>
      post.id === postId ? { ...post, [field]: value } : post
    );

    const updatedDataset = {
      ...dataset,
      posts: updatedPosts,
    };

    setDataset(updatedDataset);

    try {
      await saveEntry("current", updatedDataset);
      setSuccess("Post metadata saved.");
    } catch (err) {
      console.error(err);
      setError("Could not save the metadata.");
    }
  }

  async function handleReset() {
    if (
      !window.confirm(
        "Delete the dataset and ALL child and parent responses? This cannot be undone."
      )
    ) {
      return;
    }

    try {
      await clearStudyData();
      setDataset(null);
      setChildResponses({});
      setParentResponses({});
      setSuccess("Dataset and participant responses removed.");
      setError("");
    } catch (err) {
      setError("Could not reset the study data.");
    }
  }

  function childIsComplete(response) {
    return (
      response &&
      response.like_rating !== undefined &&
      response.wants_more !== undefined
    );
  }

  function parentIsComplete(response) {
    return (
      response &&
      Array.isArray(response.perceived_values) &&
      response.perceived_values.length > 0 &&
      response.comfort_rating !== undefined &&
      response.content_preference &&
      response.discussion_interest
    );
  }

  const posts = dataset?.posts || [];
  const postCount = posts.length;

  const childCount = posts.filter((post) =>
    childIsComplete(childResponses[post.id])
  ).length;

  const parentCount = posts.filter((post) =>
    parentIsComplete(parentResponses[post.id])
  ).length;

  function exportJSON() {
    const exportData = {
      exportedAt: new Date().toISOString(),
      dataset: {
        fileName: dataset.fileName,
        uploadedAt: dataset.uploadedAt,
        posts: posts.map(({ image, ...post }) => post),
      },
      responses: posts.map((post) => ({
        post_id: post.id,
        caption: post.caption,
        child: childResponses[post.id] || null,
        parent: parentResponses[post.id] || null,
      })),
    };

    downloadFile(
      JSON.stringify(exportData, null, 2),
      "parent-child-evaluation.json",
      "application/json"
    );
  }

  function exportCSV() {
    const columns = [
      "post_id",
      "caption",
      "description",
      "intent",
      "assigned_values",
      "topic",
      "child_like_rating",
      "child_wants_more",
      "parent_perceived_values",
      "parent_comfort_rating",
      "parent_content_preference",
      "parent_discussion_interest",
      "parent_discussion_note",
    ];

    const rows = posts.map((post) => {
      const child = childResponses[post.id] || {};
      const parent = parentResponses[post.id] || {};

      return [
        post.id,
        post.caption,
        post.description,
        post.intent,
        post.values,
        post.topic,
        child.like_rating,
        child.wants_more,
        parent.perceived_values,
        parent.comfort_rating,
        parent.content_preference,
        parent.discussion_interest,
        parent.discussion_note,
      ];
    });

    const csv = [
      columns.map(csvEscape).join(","),
      ...rows.map((row) => row.map(csvEscape).join(",")),
    ].join("\n");

    downloadFile(
      csv,
      "parent-child-evaluation.csv",
      "text/csv;charset=utf-8"
    );
  }

  return (
    <main className="developer-page">
      <header className="developer-header">
        <div>
          <p className="dev-eyebrow">RESEARCH CONTROL PANEL</p>
          <h1>Study dashboard</h1>
          <p>Manage your study content and evaluation sessions.</p>
        </div>

        <a className="back-link" href="/child">
          ← AI mediator
        </a>
      </header>

      <section className="dev-overview">
        <div className="dev-stat">
          <span>Uploaded posts</span>
          <strong>{postCount}</strong>
        </div>

        <div className="dev-stat">
          <span>Child evaluations</span>
          <strong>{childCount} / {postCount}</strong>
          <small>{postCount ? Math.round((childCount / postCount) * 100) : 0}% completed</small>
        </div>

        <div className="dev-stat">
          <span>Parent evaluations</span>
          <strong>{parentCount} / {postCount}</strong>
          <small>{postCount ? Math.round((parentCount / postCount) * 100) : 0}% completed</small>
        </div>
      </section>

      <section className="upload-section">
        <div>
          <p className="dev-eyebrow">CONTENT MANAGEMENT</p>
          <h2>Study dataset</h2>
          <p>Upload a ZIP containing posts.json and associated images, or post folders.</p>
        </div>

        <label className="upload-button">
          {loading ? "Importing..." : "＋ Upload ZIP"}
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={handleUpload}
            disabled={loading}
            hidden
          />
        </label>

        {error && <div className="dev-alert error">{error}</div>}
        {success && <div className="dev-alert success">{success}</div>}

        {dataset && (
          <div className="dataset-info">
            <div>
              <strong>{dataset.fileName}</strong>
              <span>
                {postCount} posts · Uploaded{" "}
                {new Date(dataset.uploadedAt).toLocaleString()}
              </span>
            </div>

            <button className="reset-button" onClick={handleReset}>
              Reset study
            </button>
          </div>
        )}
      </section>

      {dataset && (
        <>
          <section className="dev-export-section">
            <div>
              <p className="dev-eyebrow">RESEARCH DATA</p>
              <h2>Export responses</h2>
              <p>Responses are matched using each post's unique ID.</p>
            </div>

            <div className="dev-export-buttons">
              <button onClick={exportJSON}>Download JSON</button>
              <button onClick={exportCSV}>Download CSV</button>
            </div>
          </section>

          <section className="preview-heading">
            <div>
              <p className="dev-eyebrow">DATASET PREVIEW</p>
              <h2>Posts and research metadata</h2>
            </div>
            <span>{postCount} items</span>
          </section>

          <section className="post-grid">
            {posts.map((post, index) => (
              <article className="dev-post-card" key={post.id}>
                <img src={post.image} alt={`Post ${post.id}`} />

                <div className="dev-post-content">
                  <div className="dev-post-number">
                    POST {String(index + 1).padStart(2, "0")}
                  </div>

                  <h3>{post.id}</h3>

                  <div className="metadata-editor">
                    <label>
                      Caption
                      <textarea
                        value={post.caption || ""}
                        onChange={(e) =>
                          updatePost(post.id, "caption", e.target.value)
                        }
                        rows={3}
                      />
                    </label>

                    <label>
                      Research description
                      <textarea
                        value={post.description || ""}
                        onChange={(e) =>
                          updatePost(post.id, "description", e.target.value)
                        }
                        rows={2}
                        placeholder="Describe the content..."
                      />
                    </label>

                    <label>
                      Intended message / intent
                      <textarea
                        value={post.intent || ""}
                        onChange={(e) =>
                          updatePost(post.id, "intent", e.target.value)
                        }
                        rows={2}
                        placeholder="What is the intended message?"
                      />
                    </label>

                    <label>
                      Assigned values
                      <input
                        value={(post.values || []).join(", ")}
                        onChange={(e) =>
                          updatePost(
                            post.id,
                            "values",
                            e.target.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean)
                          )
                        }
                        placeholder="Achievement, belonging, appearance..."
                      />
                      <small>Separate values with commas.</small>
                    </label>

                    <label>
                      Topic
                      <input
                        value={post.topic || ""}
                        onChange={(e) =>
                          updatePost(post.id, "topic", e.target.value)
                        }
                        placeholder="e.g. Lifestyle, education..."
                      />
                    </label>
                  </div>

                  <div className="dev-response-status">
                    <span>
                      Child: {childIsComplete(childResponses[post.id]) ? "Completed" : "Pending"}
                    </span>
                    <span>
                      Parent: {parentIsComplete(parentResponses[post.id]) ? "Completed" : "Pending"}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </section>

          <section className="evaluation-launch">
            <div>
              <p className="dev-eyebrow">NEXT STEP</p>
              <h2>Evaluation interfaces</h2>
              <p>Both participants evaluate the same uploaded posts independently.</p>
            </div>

            <div className="launch-buttons">
              <a href="/evaluation/child">Open child interface →</a>
              <a href="/evaluation/parent">Open parent interface →</a>
            </div>
          </section>
        </>
      )}

      {!dataset && !loading && (
        <section className="empty-dataset">
          <div className="empty-dataset-icon">↑</div>
          <h2>No dataset uploaded yet</h2>
          <p>Upload your study ZIP to preview posts and prepare evaluation sessions.</p>
        </section>
      )}
    </main>
  );
}
