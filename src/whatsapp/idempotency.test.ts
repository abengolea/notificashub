import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimInboundMessage } from "./idempotency";

const mockDb = {
  runTransaction: vi.fn(),
  collection: vi.fn(),
} as Parameters<typeof claimInboundMessage>[0];

describe("claimInboundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns claimed when message is new", async () => {
    const mockRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
    };
    mockDb.collection = vi.fn(() => ({ doc: () => mockRef }));
    mockDb.runTransaction = vi.fn().mockImplementation(async (fn) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn(),
      };
      return fn(tx);
    });

    const result = await claimInboundMessage(mockDb, "wamid.123", {
      phone: "5491112345678",
      payload: { id: "wamid.123", type: "text" },
    });

    expect(result).toEqual({ claimed: true, existing: false });
  });

  it("returns existing when message already processed", async () => {
    mockDb.runTransaction = vi.fn().mockImplementation(async (fn) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: true }),
        set: vi.fn(),
      };
      return fn(tx);
    });

    const result = await claimInboundMessage(mockDb, "wamid.456", {
      phone: "5491112345678",
      payload: {},
    });

    expect(result).toEqual({ claimed: false, existing: true });
  });
});
