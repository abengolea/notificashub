import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  extractRegatasTextFromMetaMessage,
  buildRegatasPlusWebhookBody,
} from "./tenant-webhook-payload";

vi.mock("./regatas-media-upload", () => ({
  uploadInboundMediaSignedUrl: vi.fn().mockResolvedValue("https://signed.example/image.jpg"),
}));

import { uploadInboundMediaSignedUrl } from "./regatas-media-upload";

beforeEach(() => {
  vi.mocked(uploadInboundMediaSignedUrl).mockResolvedValue("https://signed.example/image.jpg");
});

describe("extractRegatasTextFromMetaMessage", () => {
  it("extrae texto", () => {
    expect(
      extractRegatasTextFromMetaMessage({
        type: "text",
        text: { body: "Hola" },
      })
    ).toBe("Hola");
  });

  it("lista interactiva", () => {
    expect(
      extractRegatasTextFromMetaMessage({
        type: "interactive",
        interactive: {
          type: "list_reply",
          list_reply: { id: "1", title: "Opción A", description: "Sub" },
        },
      })
    ).toBe("Opción A — Sub");
  });
});

describe("buildRegatasPlusWebhookBody", () => {
  it("arma payload texto y normaliza teléfono", async () => {
    const body = await buildRegatasPlusWebhookBody({
      phone: "1166667777",
      tenantId: "regatas",
      waMessageId: "wamid.1",
      message: { type: "text", text: { body: "ok" } },
    });
    expect(body).toEqual({
      phone: "5491166667777",
      tenantId: "regatas",
      waMessageId: "wamid.1",
      message: { type: "text", text: "ok" },
    });
  });

  it("imagen con URL firmada", async () => {
    const body = await buildRegatasPlusWebhookBody({
      phone: "5491112345678",
      tenantId: "regatas",
      waMessageId: "wamid.2",
      message: { type: "image", image: { id: "x" } },
      imageBase64: "aaa",
      imageMimeType: "image/png",
    });
    expect(body.message.type).toBe("image");
    expect(body.message.imageUrl).toBe("https://signed.example/image.jpg");
  });
});
