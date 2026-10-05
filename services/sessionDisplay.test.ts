import { describe, expect, it } from "vitest";
import { User } from "../types";
import { greetingFor, limaHour, limaLongDate, userFirstName, userFullName, userInitial, userInitials } from "./sessionDisplay";

const base: User = { username: "jchacon", role: "ADMIN", personnelId: "", isActive: true, permissions: [] };

describe("presentación del usuario", () => {
  it("usa el primer nombre del personal, sin gritar", () => {
    const user = { ...base, personnelData: { id: "1", firstName: "JORGE LUIS", lastName: "CHACÓN VILLACÍS", dni: "1" } };
    expect(userFirstName(user)).toBe("Jorge");
    expect(userFullName(user)).toBe("Jorge Luis Chacón Villacís");
    expect(userInitial(user)).toBe("J");
    expect(userInitials(user)).toBe("JC");
  });

  it("cae en el usuario si la cuenta no tiene personal", () => {
    expect(userFirstName(base)).toBe("jchacon");
    expect(userFullName(base)).toBe("jchacon");
    expect(userInitial(base)).toBe("J");
    expect(userInitial(null)).toBe("?");
    expect(userInitials(base)).toBe("J");
  });
});

describe("saludo en hora de Lima", () => {
  // Lima es UTC-5 todo el año.
  const enLima = (hora: number) => new Date(Date.UTC(2026, 9, 3, hora + 5, 30));

  it("lee la hora de Lima aunque el equipo esté en otro huso", () => {
    expect(limaHour(new Date("2026-10-03T03:00:00Z"))).toBe(22);
  });

  it("saluda según el momento del día", () => {
    expect(greetingFor(enLima(7))).toBe("Buenos días");
    expect(greetingFor(enLima(12))).toBe("Buenas tardes");
    expect(greetingFor(enLima(17))).toBe("Buenas tardes");
    expect(greetingFor(enLima(18))).toBe("Buenas noches");
    expect(greetingFor(enLima(2))).toBe("Buenas noches");
  });

  it("escribe la fecha larga con mayúscula inicial", () => {
    expect(limaLongDate(enLima(10))).toBe("Sábado, 3 de octubre de 2026");
  });
});
