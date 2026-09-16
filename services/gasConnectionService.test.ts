import { describe, it, expect } from "vitest";
import { diagnoseGasResponse } from "./gasConnectionService";

describe("gasConnectionService", () => {
  it("diagnoses 404 Google Page Not Found response properly", () => {
    const html404 = `<!DOCTYPE html><html><head><title>Page Not Found</title></head><body>Sorry, the file you have requested does not exist.</body></html>`;
    const diag = diagnoseGasResponse(404, html404);
    expect(diag.error).toContain("404");
    expect(diag.diagnostic).toContain("La URL no existe o la implementación fue eliminada");
  });

  it("diagnoses Google Login / permissions required response", () => {
    const htmlLogin = `<!DOCTYPE html><html><body><a href="https://accounts.google.com/ServiceLogin">Sign in to Google</a></body></html>`;
    const diag = diagnoseGasResponse(200, htmlLogin);
    expect(diag.error).toContain("Privado");
    expect(diag.diagnostic).toContain("Cualquier usuario");
  });

  it("diagnoses Apps Script internal runtime exception in doGet", () => {
    const htmlErr = `Error de script: ReferenceError: SpreadsheetApp is not defined in doGet`;
    const diag = diagnoseGasResponse(200, htmlErr);
    expect(diag.error).toContain("Error interno");
    expect(diag.diagnostic).toContain("doGet()");
  });

  it("diagnoses AbortError timeout properly", () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    const diag = diagnoseGasResponse(0, "", abortErr);
    expect(diag.error).toContain("Tiempo de espera agotado");
  });

  it("diagnoses Rate Limit response properly", () => {
    const diag = diagnoseGasResponse(429, "Too Many Requests. Quota exceeded.");
    expect(diag.error).toContain("cuota");
  });
});
