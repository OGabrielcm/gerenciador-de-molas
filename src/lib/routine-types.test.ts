import { describe, it, expect } from "vitest";
import { getDueRoutineDate } from "./routine-types";

// 2026-11-23 é segunda-feira (1). 2026-11-20 é sexta (5).
const MONDAY = "2026-11-23";

describe("getDueRoutineDate", () => {
  it("gera hoje quando hoje é dia marcado e nunca gerou", () => {
    expect(getDueRoutineDate([1], null, "2026-11-01", MONDAY)).toBe(MONDAY);
  });

  it("gera hoje quando a rotina foi criada hoje", () => {
    expect(getDueRoutineDate([1], null, MONDAY, MONDAY)).toBe(MONDAY);
  });

  it("não gera de novo no mesmo dia", () => {
    expect(getDueRoutineDate([1], MONDAY, "2026-11-01", MONDAY)).toBeNull();
  });

  it("gera o dia perdido mais recente (sexta passada) com prazo naquele dia", () => {
    expect(getDueRoutineDate([5], "2026-11-13", "2026-11-01", MONDAY)).toBe("2026-11-20");
  });

  it("não gera dia marcado anterior à criação da rotina", () => {
    expect(getDueRoutineDate([5], null, "2026-11-22", MONDAY)).toBeNull();
  });

  it("com vários dias, escolhe o mais recente", () => {
    expect(getDueRoutineDate([1, 5], "2026-11-20", "2026-11-01", MONDAY)).toBe(MONDAY);
  });

  it("sem dias marcados, não gera", () => {
    expect(getDueRoutineDate([], null, "2026-11-01", MONDAY)).toBeNull();
  });
});
