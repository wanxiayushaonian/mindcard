"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { graphApi, type GraphRelation } from "@/lib/api";

interface TripleFeedbackProps {
  workspaceId: string;
  cardId?: string;
}

export default function TripleFeedback({ workspaceId, cardId }: TripleFeedbackProps) {
  const { data: relations } = useSWR(
    workspaceId ? `graph-relations-${workspaceId}` : null,
    () => graphApi.getRelations(workspaceId)
  );

  const filteredRelations = cardId
    ? relations?.filter((r) => r.source_card_id === cardId)
    : relations;

  const [feedbackState, setFeedbackState] = useState<Record<string, string>>({});

  const handleFeedback = async (tripleId: string, type: string) => {
    try {
      await graphApi.submitFeedback(tripleId, type);
      setFeedbackState((prev) => ({ ...prev, [tripleId]: type }));
      mutate(`graph-relations-${workspaceId}`);
    } catch (err) {
      console.error("Feedback failed:", err);
    }
  };

  if (!filteredRelations || filteredRelations.length === 0) {
    return (
      <div className="text-sm text-gray-400">
        No knowledge graph triples yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-white">
        Knowledge Graph Triples
      </h3>
      {filteredRelations.slice(0, 20).map((rel) => (
        <div
          key={rel.id}
          className="flex items-center gap-2 text-sm py-1 border-b border-gray-700/50"
        >
          <span className="font-medium text-white">{rel.head_name}</span>
          <span className="text-blue-400">{rel.relation}</span>
          <span className="font-medium text-white">{rel.tail_name}</span>

          <div className="ml-auto flex gap-1">
            <button
              onClick={() => handleFeedback(rel.id, "good")}
              className={`px-1.5 py-0.5 rounded text-xs ${
                feedbackState[rel.id] === "good"
                  ? "bg-green-500/20 text-green-400"
                  : "hover:bg-gray-700 text-gray-400"
              }`}
              title="Good extraction"
            >
              +1
            </button>
            <button
              onClick={() => handleFeedback(rel.id, "bad")}
              className={`px-1.5 py-0.5 rounded text-xs ${
                feedbackState[rel.id] === "bad"
                  ? "bg-red-500/20 text-red-400"
                  : "hover:bg-gray-700 text-gray-400"
              }`}
              title="Bad extraction"
            >
              -1
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
