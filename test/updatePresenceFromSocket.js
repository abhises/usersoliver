import Users from "../service/Users.js";

export default async function testUpdatePresenceFromSocket() {
  // Update user presence in Redis
  // ⚡ Presence Heartbeat
  // Should work
  console.log(
    "result1",
    await Users.updatePresenceFromSocket("u1", "conn-xyz")
  );

  // Should fail
  console.log("result2", await Users.updatePresenceFromSocket("", ""));

  // Optionally, you can return some status or result
  //   return { success: true };
}

testUpdatePresenceFromSocket();
