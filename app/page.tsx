// Home page. Renders the saved results straight from results.json, so loading it makes no API call.
import DiagramTable from "@/components/DiagramTable";
import type { ResultsFile } from "@/lib/types";
import savedResults from "@/results.json";

// JSON imports are typed loosely (e.g. status is just `string`); the generate script wrote this file as a ResultsFile.
const results = savedResults as ResultsFile;

export default function HomePage() {
  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8">
      <h1 className="text-2xl font-semibold">Science Diagram Maker</h1>
      <p className="mt-2 mb-6 text-gray-600">
        Animated GCSE science diagrams drawn by an AI model and checked in code. Saved results from results.json,
        generated {new Date(results.generatedAt).toUTCString()}.
      </p>
      <DiagramTable initialResults={results.results} />
    </main>
  );
}
