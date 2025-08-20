import Users from "../service/Users.js";

export default async function testPresenceStatus() {
  const user = await Users.getCriticalUserData("u1");
  console.log("User Presence Status:", user);

  //   Batch
  console.log("batch", await Users.getBatchOnlineStatus(["u1", "u2"]));

  // Invalid
  console.log(await Users.getOnlineStatus(""));
}
testPresenceStatus();
