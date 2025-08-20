import Users from "../service/Users.js";

export default async function testBuildUserSettings() {
  const userSettings = await Users.buildUserSettings("u1");

  console.log("User Settings:", userSettings);
}

testBuildUserSettings();
