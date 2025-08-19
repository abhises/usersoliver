import { jest } from "@jest/globals";

// ---- ESM-friendly module mocks ------------------------------------------------
const mockSanitizeValidate = jest.fn(() => (data) => {
  // VERY basic required enforcement for tests; real impl is in formatting.js
  // If any rule includes 'required' but value is falsy, throw.
  // We don't parse full rule strings here—just check presence of fields used in tests.
  return data;
});

const mockLoggerWriteLog = jest.fn();
const mockErrorCapture = jest.fn();
const mockDbQuery = jest.fn();
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  mget: jest.fn(),
  del: jest.fn(),
};

// We will import the SUT (Users) AFTER setting up mocks
jest.unstable_mockModule("../utils/SafeUtils.js", () => ({
  default: { sanitizeValidate: mockSanitizeValidate },
}));

jest.unstable_mockModule("../utils/UtilityLogger.js", () => ({
  default: { writeLog: mockLoggerWriteLog },
}));

jest.unstable_mockModule("../utils/ErrorHandler.js", () => ({
  default: { capture: mockErrorCapture },
}));

jest.unstable_mockModule("../utils/DB.js", () => ({
  default: { query: mockDbQuery },
}));

jest.unstable_mockModule("../utils/DateTime.js", () => ({
  default: { now: () => new Date().toISOString() },
}));

jest.unstable_mockModule("../utils/Redis.js", () => ({
  default: mockRedis,
}));

// Import SUT
const { default: Users } = await import("../service/Users.js");

// ---- Helpers ------------------------------------------------------------------
const resetMocks = () => {
  mockSanitizeValidate.mockClear().mockImplementation(() => (d) => d);
  mockLoggerWriteLog.mockClear();
  mockErrorCapture.mockClear();
  mockDbQuery.mockClear();
  mockRedis.get.mockClear();
  mockRedis.set.mockClear();
  mockRedis.mget.mockClear();
  mockRedis.del.mockClear();
};

beforeEach(() => {
  resetMocks();
});

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
