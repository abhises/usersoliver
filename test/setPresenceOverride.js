import Users from "../service/Users.js";

export default async function testSetPresenceOverride() {
  //   🎛️ Presence Override
  //   Should work
  const result = await Users.setPresenceOverride("u1", "away");
  console.log("result", result);
  //   Should fail
  const result2 = await Users.setPresenceOverride("u1", "weirdmode");
  console.log("result2", result2);
  // should return false
  const result3 = await Users.setPresenceOverride("u200", "invalidmode");
  console.log("result3", result3);
}
testSetPresenceOverride();
