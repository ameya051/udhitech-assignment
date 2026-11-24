// The Generate button for one row, with its running state and error box. Used by DiagramRow.
// Holds no state: DiagramTable decides who is generating, so only one runs at a time.

interface GenerateControlsProps {
  isGenerating: boolean; // this row is running
  isDisabled: boolean; // some row is running
  error: string | undefined;
  onGenerate: () => void;
}

export default function GenerateControls({ isGenerating, isDisabled, error, onGenerate }: GenerateControlsProps) {
  const waitingForOtherRow = isDisabled && !isGenerating;

  return (
    <div className="flex w-36 flex-col items-start gap-2">
      <button
        type="button"
        className="rounded border border-blue-600 bg-white px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isDisabled}
        title={waitingForOtherRow ? "Another diagram is generating" : "Run the pipeline live for this concept"}
        onClick={onGenerate}
      >
        {isGenerating ? "Generating…" : "Generate"}
      </button>
      {isGenerating && <div className="text-xs text-gray-500">Can take up to a minute.</div>}
      {error !== undefined && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
