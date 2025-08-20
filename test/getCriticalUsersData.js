import Users from "../service/Users.js";

export default async function testGetCriticalUsersData() {
  //   👥 Batch Critical Users
  //   Should work
  const data1 = await Users.getCriticalUsersData(["u1", "u2"]);
  console.log(data1);

  //   Should fail
  const data2 = await Users.getCriticalUsersData(null);
  console.log(data2); // []
}

testGetCriticalUsersData();
