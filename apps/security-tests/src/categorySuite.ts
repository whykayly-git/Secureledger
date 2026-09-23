import { CategoryDescriptor } from "./categoryTrial";
import { runFieldModificationCategory } from "./categories/fieldModification";
import { runDeletionCategory } from "./categories/deletion";
import { runInsertionCategory } from "./categories/insertion";
import { runReorderingCategory } from "./categories/reordering";
import { runHashTamperCategory } from "./categories/hashTamper";
import { runMerkleTamperCategory } from "./categories/merkleTamper";
import { runSignatureTamperCategory } from "./categories/signatureTamper";
import { runTimingCategory } from "./categories/timing";
import { runControlTrials } from "./categories/control";

export const CATEGORIES: CategoryDescriptor[] = [
  { id: "a", label: "Field-level modification", run: runFieldModificationCategory },
  { id: "b", label: "Deletion of a posted entry", run: runDeletionCategory },
  { id: "c", label: "Insertion of an unauthorised entry", run: runInsertionCategory },
  { id: "d", label: "Reordering of entries within a batch", run: runReorderingCategory },
  { id: "e", label: "Direct modification of a stored hash-chain value", run: runHashTamperCategory },
  { id: "f", label: "Modification of a stored Merkle checkpoint/root", run: runMerkleTamperCategory },
  { id: "g", label: "Substitution of an invalid/mismatched signature", run: runSignatureTamperCategory },
  { id: "h", label: "Alteration before vs. after checkpointing", run: runTimingCategory },
];

export { runControlTrials };
