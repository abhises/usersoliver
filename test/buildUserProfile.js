import Users from "../service/Users.js";

export default async function testBuildUserProfile() {
  const userProfile = await Users.buildUserProfile("u1");

  console.log("User Profile:", userProfile);
}

testBuildUserProfile();
