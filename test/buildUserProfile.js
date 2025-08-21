import Users from "../service/Users.js";

export default async function testBuildUserProfile() {
  const userProfile = await Users.buildUserProfile("u1");

  console.log("User Profile:test1", userProfile);

  const userProfile2 = await Users.buildUserProfile("u2");

  console.log("User Profile:test2", userProfile2);
  const userProfile3 = await Users.buildUserProfile("u3");

  console.log("User Profile:test3", userProfile3);
}

testBuildUserProfile();
