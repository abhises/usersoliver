import Users from "../service/Users.js";

export default async function testGetCriticalUserData() {
  // 👤 Critical User Data
  // Should work
  const cud = await Users.getCriticalUserData("u1");
  console.log("cud", cud);
  // { username, displayName, avatar, online, status }

  // Should fail (invalid UID)
  const cud2 = await Users.getCriticalUserData("");
  console.log(cud2); // null
}

testGetCriticalUserData();
