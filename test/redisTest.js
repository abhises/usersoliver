import Redis from "../utils/Redis.js";

export default async function testRedisConnection() {
  try {
    await Redis.connect();
    console.log("Connected to Redis!");

    // Test set and get
    const testKey = "test_key";
    const testValue = { hello: "world" };

    const setting = await Redis.set(testKey, testValue, { expiry: 10 });
    console.log("Set operation result:", setting);
    const value = await Redis.get(testKey);
    console.log("Getting from Redis:", value);

    // console.log("Value from Redis:", value);

    // Clean up

    if (value && value.result && value.result.hello === "world") {
      console.log("Redis test passed!");
      await Redis.del(testKey);
      await Redis.disconnect();
      return true;
    } else {
      console.error("Redis test failed: Value mismatch");
      return false;
    }
  } catch (err) {
    console.error("Redis test failed:", err);
    return false;
  }
}
testRedisConnection();
