import Redis from "../utils/Redis.js";

export default async function testRedisConnection() {
  try {
    await Redis.connect();
    console.log("Connected to Redis!");

    // Test set and get
    const testKey = "test_key";
    const testValue = { hello: "world" };
    const testKey1 = "test_key_1";
    const testValue1 = 20;
    const testKey3 = "username:to:uid:nepali4";

    const user1Key = "presence_override_user_u1";
    const user2Key = "presence_override_user_u2";

    // Set presence (online/offline)
    await Redis.set(user1Key, "online");
    await Redis.set(user2Key, "offline");

    const setting = await Redis.set(testKey, testValue);
    const setting1 = await Redis.set(testKey1, testValue1);

    console.log("Set operation result:", setting);
    console.log("Set operation result for test_key_1:", setting1);
    const value = await Redis.get(testKey);
    console.log("Getting from Redis:", value);
    const value1 = await Redis.get(testKey1);
    console.log("Value from Redis:", value1);
    const value3 = await Redis.get(testKey3);
    console.log("Value from Redis:", value3);

    const keys = await Redis.keys("*");
    console.log("All keys:", keys);

    // Or safer way (SCAN)
    const scannedKeys = await Redis.scan("*");
    console.log("Scanned keys:", scannedKeys);

    // Get values
    const allData = await Redis.getAllKeysAndValues("*");
    console.log("All keys and values:", allData);

    // Clean up

    if (value && value.result && value.result.hello === "world") {
      console.log("Redis test passed!");
      // await Redis.del(testKey);
      await Redis.disconnect();
      return true;
    } else {
      console.error("Redis test failed: Value mismatch");
      return false;
    }
    // Fetch all keys
  } catch (err) {
    console.error("Redis test failed:", err);
    return false;
  }
}
testRedisConnection();
