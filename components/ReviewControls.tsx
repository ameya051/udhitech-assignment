"use client";

// Approve / Reject buttons and a note for one diagram. Used by DiagramRow.
// Side effect: reads and writes the browser's localStorage, so reviews survive a refresh.

import { useEffect, useRef, useState } from "react";
import { NOTE_SAVE_DELAY_MS } from "@/lib/config";
import type { ConceptId, ReviewDecision, StoredReview } from "@/lib/types";

type SaveStatus = "idle" | "saved" | "failed";

interface ReviewControlsProps {
  conceptId: ConceptId;
}

const BUTTON = "rounded border px-3 py-1 text-sm font-medium disabled:opacity-50";
const INACTIVE_BUTTON = "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";

export default function ReviewControls({ conceptId }: ReviewControlsProps) {
  const [decision, setDecision] = useState<ReviewDecision>(null);
  const [note, setNote] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // localStorage only exists in the browser, so it is read after mount. Reading it during
  // render would make the server HTML differ from the first browser render (hydration mismatch).
  useEffect(() => {
    const saved = loadReview(conceptId);
    if (saved !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from browser-only storage after mount
      setDecision(saved.decision);
      setNote(saved.note);
    }
    setIsLoaded(true);
  }, [conceptId]);

  // Don't let a pending note save fire after the row is gone.
  useEffect(() => {
    return () => {
      if (noteTimer.current !== null) clearTimeout(noteTimer.current);
    };
  }, []);

  function save(nextDecision: ReviewDecision, nextNote: string) {
    setSaveStatus(saveReview(conceptId, nextDecision, nextNote) ? "saved" : "failed");
  }

  // Clicking the decision that is already active clears it.
  function handleDecision(clicked: "approved" | "rejected") {
    const nextDecision = decision === clicked ? null : clicked;
    setDecision(nextDecision);
    save(nextDecision, note);
  }

  function handleNoteChange(nextNote: string) {
    setNote(nextNote);
    setSaveStatus("idle");
    if (noteTimer.current !== null) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => save(decision, nextNote), NOTE_SAVE_DELAY_MS);
  }

  // Leaving the box saves straight away, so a quick refresh can't lose the last words typed.
  function handleNoteBlur() {
    if (noteTimer.current !== null) clearTimeout(noteTimer.current);
    save(decision, note);
  }

  const approveStyle = decision === "approved" ? "border-green-600 bg-green-600 text-white" : INACTIVE_BUTTON;
  const rejectStyle = decision === "rejected" ? "border-red-600 bg-red-600 text-white" : INACTIVE_BUTTON;

  return (
    <div className="flex w-44 flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          className={`${BUTTON} ${approveStyle}`}
          aria-pressed={decision === "approved"}
          disabled={!isLoaded}
          onClick={() => handleDecision("approved")}
        >
          Approve
        </button>
        <button
          type="button"
          className={`${BUTTON} ${rejectStyle}`}
          aria-pressed={decision === "rejected"}
          disabled={!isLoaded}
          onClick={() => handleDecision("rejected")}
        >
          Reject
        </button>
      </div>
      <textarea
        className="rounded border border-gray-300 p-1 text-xs"
        rows={2}
        placeholder="Note (optional)"
        aria-label="Review note"
        value={note}
        disabled={!isLoaded}
        onChange={(event) => handleNoteChange(event.target.value)}
        onBlur={handleNoteBlur}
      />
      {saveStatus === "saved" && <div className="text-xs text-green-700">Saved</div>}
      {saveStatus === "failed" && <div className="text-xs text-red-700">Could not save (browser storage blocked)</div>}
    </div>
  );
}

// `v1` lets the stored shape change later without misreading old data.
function storageKey(conceptId: ConceptId): string {
  return `review:v1:${conceptId}`;
}

// localStorage can throw (private mode, blocked storage), so every access is guarded.
function loadReview(conceptId: ConceptId): StoredReview | null {
  try {
    return parseStoredReview(localStorage.getItem(storageKey(conceptId)));
  } catch (error) {
    console.warn(`Could not read review for ${conceptId}; starting empty.`, error);
    return null;
  }
}

function saveReview(conceptId: ConceptId, decision: ReviewDecision, note: string): boolean {
  const review: StoredReview = { decision, note, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(storageKey(conceptId), JSON.stringify(review));
    return true;
  } catch (error) {
    console.warn(`Could not save review for ${conceptId}.`, error);
    return false;
  }
}

// Stored text could be missing, hand-edited or from an older format: anything unexpected becomes null.
function parseStoredReview(text: string | null): StoredReview | null {
  if (text === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn("Ignoring a saved review that is not valid JSON.");
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { decision, note, updatedAt } = parsed as Record<string, unknown>;
  const isValidDecision = decision === "approved" || decision === "rejected" || decision === null;
  if (!isValidDecision || typeof note !== "string") return null;

  return { decision, note, updatedAt: typeof updatedAt === "string" ? updatedAt : "" };
}
