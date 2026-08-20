import {
  actionCards,
  buildActionDeck,
  eventCards,
  okrCards,
  requirementCards,
} from "../src/index.js";

const ACTION_REQUIRED = [
  "id",
  "name",
  "category",
  "rarity",
  "workHours",
  "effectText",
  "copies",
] as const;

const INTERACTION_IDS = ["C-12", "C-13", "C-14"];
const EVENT_IDS = Array.from({ length: 9 }, (_, index) => `E-${String(index + 1).padStart(2, "0")}`);
const REQUIREMENT_IDS = Array.from({ length: 6 }, (_, index) => `R-${String(index + 1).padStart(2, "0")}`);
const OKR_IDS = Array.from({ length: 6 }, (_, index) => `O-${String(index + 1).padStart(2, "0")}`);

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function validateActionCards(): void {
  for (const card of actionCards) {
    for (const field of ACTION_REQUIRED) {
      assert(
        field in card && card[field as keyof typeof card] !== undefined,
        `Action card ${card.id ?? "?"} missing field: ${field}`,
      );
    }
  }

  assert(buildActionDeck().length === 42, `Action deck must have 42 copies, got ${buildActionDeck().length}`);

  for (const id of INTERACTION_IDS) {
    const card = actionCards.find((entry) => entry.id === id);
    assert(card !== undefined, `Missing interaction card ${id}`);
    assert(card?.isInteraction === true, `${id} must have isInteraction: true`);
  }
}

function validateSequentialIds(ids: string[], expected: string[], label: string): void {
  assert(ids.length === expected.length, `${label} count must be ${expected.length}, got ${ids.length}`);
  for (const id of expected) {
    assert(ids.includes(id), `${label} missing ${id}`);
  }
}

function validateEventCards(): void {
  validateSequentialIds(
    eventCards.map((card) => card.id),
    EVENT_IDS,
    "Event cards",
  );
  for (const card of eventCards) {
    assert(Boolean(card.name && card.trigger && card.effectText), `${card.id} missing required text fields`);
  }
}

function validateRequirementCards(): void {
  validateSequentialIds(
    requirementCards.map((card) => card.id),
    REQUIREMENT_IDS,
    "Requirement cards",
  );
}

function validateOkrCards(): void {
  validateSequentialIds(
    okrCards.map((card) => card.id),
    OKR_IDS,
    "OKR cards",
  );
}

function main(): void {
  validateActionCards();
  validateEventCards();
  validateRequirementCards();
  validateOkrCards();
  console.log("Card validation passed: 42 action + 9 event + 6 requirement + 6 OKR");
}

main();
