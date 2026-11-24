// The 5 concepts from the brief. `text` is copied exactly; `keyTerms` drives the keyTerms check.
// Used by the pipeline, the generate script, the API route and the table.

import type { Concept, ConceptId } from "./types";

export const CONCEPTS: Concept[] = [
  {
    id: "pythagoras",
    name: "Pythagoras' theorem",
    subject: "Maths",
    text: "In a right-angled triangle, the longest side is called the hypotenuse. The square of the hypotenuse is equal to the sum of the squares of the other two sides: a² + b² = c².",
    keyTerms: [["hypotenuse"], ["a² + b² = c²", "a²+b²=c²"]],
  },
  {
    id: "circle-parts",
    name: "Parts of a circle",
    subject: "Maths",
    text: "A circle has a centre. The radius is the distance from the centre to the edge. The diameter goes across the circle through the centre and is twice the radius. The circumference is the distance around the circle.",
    keyTerms: [["centre", "center"], ["radius"], ["diameter"], ["circumference"]],
  },
  {
    id: "series-circuit",
    name: "Series circuit",
    subject: "Physics",
    text: "In a series circuit there is only one loop. The current is the same everywhere in the loop. The voltage of the cell is shared between the components.",
    keyTerms: [["cell", "battery"], ["current"], ["voltage"]],
  },
  {
    id: "photosynthesis",
    name: "Photosynthesis",
    subject: "Biology",
    text: "Plants take in carbon dioxide and water. They use light energy, absorbed by chlorophyll, to make glucose and oxygen.",
    keyTerms: [
      ["carbon dioxide", "co₂", "co2"],
      ["water", "h₂o", "h2o"],
      ["light"],
      ["chlorophyll"],
      ["glucose"],
      ["oxygen", "o₂", "o2"],
    ],
  },
  {
    id: "states-of-matter",
    name: "States of matter",
    subject: "Chemistry",
    text: "In a solid the particles are close together and vibrate in place. In a liquid they are close but move past each other. In a gas they are far apart and move fast.",
    keyTerms: [["solid"], ["liquid"], ["gas"]],
  },
];

// Returns the concept for a trusted id, or undefined for anything else (e.g. raw user input).
export function findConcept(id: string): Concept | undefined {
  return CONCEPTS.find((concept) => concept.id === id);
}

export function isConceptId(id: string): id is ConceptId {
  return findConcept(id) !== undefined;
}
