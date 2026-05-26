import { MongoClient } from 'mongodb';

const URI = 'mongodb://127.0.0.1:27017/sqlab';
const client = new MongoClient(URI, {
  serverSelectionTimeoutMS: 2000,
  connectTimeoutMS: 2000,
});

async function runTest() {
  console.log('🔌 Connecting to the Fake MongoDB Wire Protocol Server...');
  try {
    await client.connect();
    console.log('✅ Connection established successfully!\n');

    const db = client.db('sqlab');

    // 1. List databases
    console.log('📂 Fetching database list...');
    const adminDb = client.db('admin');
    const dbs = await adminDb.admin().listDatabases();
    console.log('Databases available:');
    dbs.databases.forEach((d: any) => {
      console.log(` - ${d.name} (${d.sizeOnDisk} bytes)`);
    });
    console.log();

    // 2. Query tbl_profiles without filter
    console.log('🔍 Executing general find query (no filter)...');
    const collection = db.collection('tbl_profiles');
    const unfilteredDocs = await collection.find({}).toArray();
    console.log(`Retrieved ${unfilteredDocs.length} profiles:`);
    console.dir(unfilteredDocs, { depth: null, colors: true });
    console.log();

    // 3. Query tbl_profiles with phone filter
    const searchPhone = '0987654321';
    console.log(`🔍 Executing specific find query for phone: "${searchPhone}"...`);
    const filteredDocs = await collection.find({ phone: searchPhone }).toArray();
    console.log(`Retrieved ${filteredDocs.length} profile(s):`);
    console.dir(filteredDocs, { depth: null, colors: true });
    console.log();

    // 4. Query tbl_profiles with an operator filter
    const otherPhone = '0912345678';
    console.log(`🔍 Executing operator find query { phone: { $eq: "${otherPhone}" } }...`);
    const opFilteredDocs = await collection.find({ phone: { $eq: otherPhone } }).toArray();
    console.log(`Retrieved ${opFilteredDocs.length} profile(s):`);
    console.dir(opFilteredDocs, { depth: null, colors: true });
    console.log();

  } catch (error: any) {
    console.error('❌ Test failed with error:', error.message);
  } finally {
    await client.close();
    console.log('🔌 Connection closed.');
  }
}

runTest();
