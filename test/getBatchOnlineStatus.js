import Users from "../service/Users.js";

export default async function testGetBatchOnlineStatus() {
  const result = await Users.getBatchOnlineStatus(["u2", "u1"]);
  console.log(result);

  const result2 = await Users.getBatchOnlineStatus(["u2o", "u122"]);
  console.log(result2);
}

testGetBatchOnlineStatus();
