import { describe, it, expect } from "vitest";
import {
  parseNumericChoice,
  parseReferralToken,
  parseInteractiveChoiceId,
  extractIncomingMessages,
  toIncomingMessage,
} from "./validate";

describe("parseNumericChoice", () => {
  it("parses text '1'", () => {
    expect(parseNumericChoice({ type: "text", text: { body: "1" } })).toBe(1);
  });
  it("parses text '2' with spaces", () => {
    expect(parseNumericChoice({ type: "text", text: { body: "  2  " } })).toBe(2);
  });
  it("parses list_reply id", () => {
    expect(
      parseNumericChoice({
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id: "3" } },
      })
    ).toBe(3);
  });
  it("parses button_reply id", () => {
    expect(
      parseNumericChoice({
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: "2" } },
      })
    ).toBe(2);
  });
  it("parseInteractiveChoiceId extracts list_reply.id", () => {
    expect(
      parseInteractiveChoiceId({
        type: "interactive",
        interactive: { list_reply: { id: "heartlink" } },
      })
    ).toBe("heartlink");
  });
  it("parseInteractiveChoiceId extracts button_reply.id", () => {
    expect(
      parseInteractiveChoiceId({
        type: "interactive",
        interactive: { button_reply: { id: "1" } },
      })
    ).toBe("1");
  });
  it("returns null for invalid text", () => {
    expect(parseNumericChoice({ type: "text", text: { body: "abc" } })).toBeNull();
    expect(parseNumericChoice({ type: "text", text: { body: "0" } })).toBeNull();
    expect(parseNumericChoice({ type: "text", text: { body: "10" } })).toBeNull();
  });
  it("returns null for empty", () => {
    expect(parseNumericChoice({ type: "text", text: { body: "" } })).toBeNull();
    expect(parseNumericChoice({})).toBeNull();
  });
});

describe("parseReferralToken", () => {
  it("extracts referral.ref", () => {
    expect(
      parseReferralToken({ referral: { ref: "RIVER" } })
    ).toBe("RIVER");
  });
  it("extracts first word from text as token", () => {
    expect(
      parseReferralToken({ type: "text", text: { body: "RIVER hola" } })
    ).toBe("RIVER");
  });
  it("normalizes to uppercase", () => {
    expect(
      parseReferralToken({ type: "text", text: { body: "river" } })
    ).toBe("RIVER");
  });
  it("returns null when first word has invalid chars (no A-Z0-9_)", () => {
    // "hola" -> HOLA matchea [A-Z0-9_]+; "¿qué?" no
    expect(
      parseReferralToken({ type: "text", text: { body: "¿qué? nada" } })
    ).toBeNull();
  });
  it("returns null when no ref or text", () => {
    expect(parseReferralToken({})).toBeNull();
    expect(parseReferralToken({ referral: {} })).toBeNull();
  });
});

describe("extractIncomingMessages", () => {
  it("extracts message from standard structure", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.xxx",
                    from: "5491112345678",
                    timestamp: "1234567890",
                    type: "text",
                    text: { body: "Hola" },
                  },
                ],
                contacts: [{ wa_id: "5491112345678", profile: { name: "Juan" } }],
              },
            },
          ],
        },
      ],
    };
    const result = extractIncomingMessages(body);
    expect(result).toHaveLength(1);
    expect(result[0].message.id).toBe("wamid.xxx");
    expect(result[0].from).toBe("5491112345678");
    expect(result[0].contactName).toBe("Juan");
  });
  it("returns empty for invalid body", () => {
    expect(extractIncomingMessages(null)).toEqual([]);
    expect(extractIncomingMessages({})).toEqual([]);
  });
  it("preserves contacts object for HeartLink (contacto compartido, médico solicitante)", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.cont123",
                    from: "5491112345678",
                    timestamp: "1234567890",
                    type: "contacts",
                    contacts: [
                      {
                        name: { formatted_name: "Dr. Juan Pérez", first_name: "Juan" },
                        wa_id: "5491155667788",
                        phones: [{ wa_id: "5491155667788", phone: "+5491155667788", type: "CELL" }],
                      },
                    ],
                  },
                ],
                contacts: [{ wa_id: "5491112345678", profile: { name: "Paciente" } }],
              },
            },
          ],
        },
      ],
    };
    const result = extractIncomingMessages(body);
    expect(result).toHaveLength(1);
    expect(result[0].message.type).toBe("contacts");
    expect(result[0].message.contacts).toBeDefined();
    expect(result[0].message.contacts).toHaveLength(1);
    expect(result[0].message.contacts?.[0]).toMatchObject({
      wa_id: "5491155667788",
      name: { formatted_name: "Dr. Juan Pérez" },
    });
    expect(result[0].message.contacts?.[0].phones).toHaveLength(1);
  });
  it("preserves video object for HeartLink (message.video.id)", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.xxx",
                    from: "5493364645357",
                    timestamp: "1772659306",
                    type: "video",
                    video: { id: "MEDIA_ID_AQUI", mime_type: "video/mp4" },
                  },
                ],
                contacts: [{ wa_id: "5493364645357", profile: { name: "Usuario" } }],
              },
            },
          ],
        },
      ],
    };
    const result = extractIncomingMessages(body);
    expect(result).toHaveLength(1);
    expect(result[0].message.type).toBe("video");
    expect(result[0].message.video).toBeDefined();
    expect(result[0].message.video?.id).toBe("MEDIA_ID_AQUI");
    expect(result[0].message.video?.mime_type).toBe("video/mp4");
  });
});

describe("toIncomingMessage", () => {
  it("normalizes message with referral", () => {
    const msg = {
      id: "wamid.1",
      from: "5491112345678",
      timestamp: "1234567890",
      type: "text",
      text: { body: "RIVER" },
    };
    const r = toIncomingMessage(msg, "5491112345678");
    expect(r.id).toBe("wamid.1");
    expect(r.referralToken).toBe("RIVER");
  });
});
