import { COUNTED_ENTRY_STATUSES } from "../src/status";

describe("COUNTED_ENTRY_STATUSES", () => {
  it("counts POSTED and VOID entries, so a voided original and its reversal net to zero", () => {
    expect(COUNTED_ENTRY_STATUSES).toContain("POSTED");
    expect(COUNTED_ENTRY_STATUSES).toContain("VOID");
  });

  it("never counts drafts", () => {
    expect(COUNTED_ENTRY_STATUSES).not.toContain("DRAFT");
  });
});
