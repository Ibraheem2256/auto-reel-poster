import { describe, expect, it } from "vitest";
import { extractFolderId, folderLinkSchema } from "@/lib/validation";
import { encryptToken, decryptToken, createOAuthState, verifyOAuthState } from "@/lib/crypto";

describe("folder link validation", () => {
  it("extracts folder IDs from standard links", () => {
    expect(extractFolderId("https://drive.google.com/drive/folders/abc123XYZ")).toBe("abc123XYZ");
    expect(extractFolderId("https://drive.google.com/open?id=xyz789")).toBe("xyz789");
    expect(extractFolderId("https://drive.google.com/drive/u/0/folders/ABC_DEF-123")).toBe("ABC_DEF-123");
  });

  it("rejects invalid links", () => {
    expect(folderLinkSchema.safeParse("https://example.com/folder/123").success).toBe(false);
    expect(folderLinkSchema.safeParse("not-a-url").success).toBe(false);
    expect(folderLinkSchema.safeParse("").success).toBe(false);
  });

  it("rejects file links, not folder links", () => {
    const res = folderLinkSchema.safeParse("https://drive.google.com/file/d/abc123/view");
    expect(res.success).toBe(false);
  });
});

describe("token encryption", () => {
  it("round-trips tokens", () => {
    const token = "ya29.example-access-token";
    const encrypted = encryptToken(token);
    expect(encrypted).not.toContain(token);
    expect(decryptToken(encrypted)).toBe(token);
  });

  it("produces different ciphertexts for the same input", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });
});

describe("OAuth state", () => {
  it("signs and verifies state", () => {
    const state = createOAuthState({ type: "drive", workspaceId: "ws_1", folderId: "f_1" });
    expect(verifyOAuthState(state)).toEqual({ type: "drive", workspaceId: "ws_1", folderId: "f_1" });
  });

  it("rejects tampered state", () => {
    const state = createOAuthState({ type: "drive", workspaceId: "ws_1", folderId: "f_1" });
    const tampered = state.slice(0, -5) + "xxxxx";
    expect(verifyOAuthState(tampered)).toBeNull();
    expect(verifyOAuthState("garbage")).toBeNull();
  });
});