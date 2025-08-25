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

    const setting = await Redis.set(testKey, testValue, { expiry: 10 });
    const setting1 = await Redis.set(testKey1, testValue1, { expiry: 10 });

    console.log("Set operation result:", setting);
    console.log("Set operation result for test_key_1:", setting1);
    const value = await Redis.get(testKey);
    console.log("Getting from Redis:", value);
    const value1 = await Redis.get(testKey1);
    console.log("Value from Redis:", value1);

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
