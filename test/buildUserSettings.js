import Users from "../service/Users.js";

export default async function testBuildUserSettings() {
  const userSettings = await Users.buildUserSettings("u1");

  console.log("User Settings:", userSettings);

  const userSettings2 = await Users.buildUserSettings("u2");

  console.log("User Settings 2:", userSettings2);

  const userSettings3 = await Users.buildUserSettings("u3");

  console.log("User Settings 3:", userSettings3);
}

testBuildUserSettings();
