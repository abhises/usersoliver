import { jest } from "@jest/globals";

// ---- ESM-friendly module mocks ------------------------------------------------
jest.mock("../utils/Redis.js", () => ({
  get: jest.fn(),
  set: jest.fn(),
  mget: jest.fn(),
  del: jest.fn(),
}));
// =================================================================================
// getCriticalUserData
// =================================================================================
describe("Users.getCriticalUserData", () => {
  test("success: returns cached CUD with merged presence", async () => {
    const uid = "u1";
    const cudKey = `cud:${uid}`;
    const presenceKey = `presence:summary:user:${uid}`;
    const overrideKey = `presence:override:user:${uid}`;

    mockRedis.get.mockImplementation(async (key) => {
      if (key === cudKey)
        return JSON.stringify({
          username: "alice",
          displayName: "Alice Doe",
          avatar: "/a.png",
          online: false,
          status: "offline",
        });
      if (key === overrideKey) return null;
      if (key === presenceKey) return "1";
      return null;
    });

    const data = await Users.getCriticalUserData(uid);
    expect(mockSanitizeValidate).toHaveBeenCalled();
    expect(data).toEqual({
      username: "alice",
      displayName: "Alice Doe",
      avatar: "/a.png",
      online: true,
      status: "online",
    });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test("success: hydrates from Postgres when CUD missing", async () => {
    const uid = "u2";
    const cudKey = `cud:${uid}`;
    const presenceKey = `presence:summary:user:${uid}`;

    mockRedis.get.mockImplementation(async (key) => {
      if (key === cudKey) return null;
      if (key === presenceKey) return null; // offline
      return null;
    });

    mockDbQuery.mockResolvedValueOnce({
      rows: [{ username: "bob", display_name: "Bob Smith", avatar: "/b.png" }],
    });

    const data = await Users.getCriticalUserData(uid);
    expect(mockSanitizeValidate).toHaveBeenCalled();
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM users WHERE uid"),
      [uid]
    );
    expect(mockRedis.set).toHaveBeenCalled(); // warmed CUD
    expect(data).toEqual({
      username: "bob",
      displayName: "Bob Smith",
      avatar: "/b.png",
      online: false,
      status: "offline",
    });
  });

  test("fail: invalid uid → returns null and captures error", async () => {
    mockSanitizeValidate.mockImplementation(() => () => {
      throw new Error("VALIDATION_ERROR");
    });
    const out = await Users.getCriticalUserData("");
    expect(out).toBeNull();
    expect(mockErrorCapture).toHaveBeenCalled();
  });
});
