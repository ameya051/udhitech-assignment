// Home page. Renders the saved results straight from results.json, so loading it makes no API call.
import DiagramTable from "@/components/DiagramTable";
import type { ResultsFile } from "@/lib/types";
import savedResults from "@/results.json";

// JSON imports are typed loosely (e.g. status is just `string`); the generate script wrote this file as a ResultsFile.
const results = savedResults as ResultsFile;

// Fixed locale and time zone, so the date reads the same on the server and in every browser.
const generatedAt = new Date(results.generatedAt).toLocaleString("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default function HomePage() {
  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8">
      <h1 className="text-2xl font-semibold">Science Diagram Maker</h1>
      <p className="mt-1 text-gray-600">
        Animated GCSE diagrams for Maths, Physics, Biology and Chemistry, drawn by an AI model and checked in code.
      </p>
      <p className="mt-1 mb-6 text-sm text-gray-500">Saved results from results.json, generated {generatedAt} UTC.</p>
      <DiagramTable initialResults={results.results} />
    </main>
  );
}
