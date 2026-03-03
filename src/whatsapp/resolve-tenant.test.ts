import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTenantForIncomingMessage } from "./resolve-tenant";

vi.mock("./firestore", () => ({
  getMemberships: vi.fn(),
  getSession: vi.fn(),
  setSession: vi.fn(),
  getPendingChoice: vi.fn(),
  setPendingChoice: vi.fn(),
  incrementPendingAttempts: vi.fn(),
  deletePendingChoice: vi.fn(),
  getLastTenant: vi.fn(),
  setLastTenant: vi.fn(),
  getSessionKey: vi.fn(() => "5491112345678_20250303"),
}));

vi.mock("./tenants", () => ({
  getTenantIdsByToken: vi.fn(),
  buildTenantOptions: vi.fn(() =>
    Promise.resolve([
      { index: 1, tenantId: "heartlink", label: "HeartLink" },
      { index: 2, tenantId: "nautica", label: "Náutica" },
    ])
  ),
}));

import {
  getMemberships,
  getSession,
  getPendingChoice,
  getLastTenant,
  setPendingChoice,
} from "./firestore";
import { getTenantIdsByToken, buildTenantOptions } from "./tenants";

const mockDb = {} as Parameters<typeof resolveTenantForIncomingMessage>[0];

describe("resolveTenantForIncomingMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTenantIdsByToken).mockResolvedValue([]);
    vi.mocked(buildTenantOptions).mockResolvedValue([
      { index: 1, tenantId: "heartlink", label: "HeartLink" },
      { index: 2, tenantId: "nautica", label: "Náutica" },
    ]);
  });

  it("returns silent_unregistered when no membership", async () => {
    vi.mocked(getMemberships).mockResolvedValue(null);
    const result = await resolveTenantForIncomingMessage(
      mockDb,
      "5491112345678",
      { id: "1", from: "5491112345678", timestamp: "123", type: "text" }
    );
    expect(result).toEqual({ action: "silent_unregistered" });
  });

  it("returns silent_unregistered when membership has empty tenantIds", async () => {
    vi.mocked(getMemberships).mockResolvedValue({
      phone: "5491112345678",
      tenantIds: [],
      updatedAt: {},
    });
    const result = await resolveTenantForIncomingMessage(
      mockDb,
      "5491112345678",
      { id: "1", from: "5491112345678", timestamp: "123", type: "text" }
    );
    expect(result).toEqual({ action: "silent_unregistered" });
  });

  it("returns route when single tenant", async () => {
    vi.mocked(getMemberships).mockResolvedValue({
      phone: "5491112345678",
      tenantIds: ["heartlink"],
      updatedAt: {},
    });
    vi.mocked(getTenantIdsByToken).mockResolvedValue([]);
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(getLastTenant).mockResolvedValue(null);
    vi.mocked(getPendingChoice).mockResolvedValue(null);

    const result = await resolveTenantForIncomingMessage(
      mockDb,
      "5491112345678",
      { id: "1", from: "5491112345678", timestamp: "123", type: "text" }
    );

    expect(result.action).toBe("route");
    if (result.action === "route") {
      expect(result.tenantId).toBe("heartlink");
    }
  });

  it("returns route when referral token matches tenant", async () => {
    vi.mocked(getMemberships).mockResolvedValue({
      phone: "5491112345678",
      tenantIds: ["heartlink", "river"],
      updatedAt: {},
    });
    vi.mocked(getTenantIdsByToken).mockResolvedValue([
      { id: "river", name: "Escuela River" },
    ]);

    const result = await resolveTenantForIncomingMessage(
      mockDb,
      "5491112345678",
      {
        id: "1",
        from: "5491112345678",
        timestamp: "123",
        type: "text",
        referralToken: "RIVER",
      }
    );

    expect(result.action).toBe("route");
    if (result.action === "route") {
      expect(result.tenantId).toBe("river");
    }
  });

  it("returns ask_choice when multiple tenants and no inference", async () => {
    vi.mocked(getMemberships).mockResolvedValue({
      phone: "5491112345678",
      tenantIds: ["heartlink", "nautica"],
      updatedAt: {},
    });
    vi.mocked(getTenantIdsByToken).mockResolvedValue([]);
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(getLastTenant).mockResolvedValue(null);
    vi.mocked(getPendingChoice).mockResolvedValue(null);

    const result = await resolveTenantForIncomingMessage(
      mockDb,
      "5491112345678",
      { id: "1", from: "5491112345678", timestamp: "123", type: "text" }
    );

    expect(result.action).toBe("ask_choice");
    if (result.action === "ask_choice") {
      expect(result.options).toHaveLength(2);
      expect(setPendingChoice).toHaveBeenCalled();
    }
  });

  it("resolves choice by interactiveChoiceId (tenantId)", async () => {
    vi.mocked(getMemberships).mockResolvedValue({
      phone: "5491112345678",
      tenantIds: ["heartlink", "nautica"],
      updatedAt: {},
    });
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(getLastTenant).mockResolvedValue(null);
    vi.mocked(getPendingChoice).mockResolvedValue({
      options: [
        { index: 1, tenantId: "heartlink", label: "HeartLink" },
        { index: 2, tenantId: "nautica", label: "Náutica" },
      ],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 600000),
      attempts: 0,
    });

    const result = await resolveTenantForIncomingMessage(
      mockDb,
      "5491112345678",
      {
        id: "1",
        from: "5491112345678",
        timestamp: "123",
        type: "interactive",
        interactiveChoiceId: "heartlink",
      }
    );

    expect(result.action).toBe("route");
    if (result.action === "route") {
      expect(result.tenantId).toBe("heartlink");
    }
  });
});
