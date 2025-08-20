import Users from "../service/Users.js";

export default async function testBuildUserData() {
  const userData = await Users.buildUserData("u1");

  console.log("User Data:", userData);
}

testBuildUserData();
