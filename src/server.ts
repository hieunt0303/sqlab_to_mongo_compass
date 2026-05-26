import net from 'net';
import dotenv from 'dotenv';
import {
  parseMessage,
  readNextFrame,
  buildOpReply,
  buildOpMsg,
  OpCode,
  MsgHeader,
} from './wire.js';
import { fetchDataFromUpstream, fetchTablesListFromUpstream } from './upstream.js';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT || '27017', 10);

// ANSI Colors for premium logging aesthetics
const CLR_RESET = '\x1b[0m';
const CLR_HEADER = '\x1b[36m';      // Cyan
const CLR_SUCCESS = '\x1b[32m';     // Green
const CLR_QUERY = '\x1b[33m';       // Yellow
const CLR_INFO = '\x1b[90m';        // Gray
const CLR_CONN = '\x1b[35m';        // Magenta
const CLR_WARN = '\x1b[31m';        // Red

let socketCounter = 0;

/**
 * Recursively extracts a 'phone' filter from any BSON/MongoDB query structure.
 */
function extractPhoneFilter(filter: any): string | null {
  if (!filter || typeof filter !== 'object') {
    return null;
  }

  // Case 1: Direct phone equality filter `{ phone: "0987654321" }`
  if (typeof filter.phone === 'string') {
    return filter.phone;
  }

  // Case 2: Nested operator filter `{ phone: { $eq: "0987654321" } }`
  if (filter.phone && typeof filter.phone === 'object') {
    if (typeof filter.phone.$eq === 'string') {
      return filter.phone.$eq;
    }
  }

  // Case 3: Logical conjunctions `{ $and: [ { phone: "0987654321" } ] }`
  if (Array.isArray(filter.$and)) {
    for (const subFilter of filter.$and) {
      const phone = extractPhoneFilter(subFilter);
      if (phone) return phone;
    }
  }

  // Case 4: Deep search for nested properties
  for (const key of Object.keys(filter)) {
    if (filter[key] && typeof filter[key] === 'object') {
      const phone = extractPhoneFilter(filter[key]);
      if (phone) return phone;
    }
  }

  return null;
}

/**
 * Extracts the main command document from the parsed packet depending on the wire opcode.
 */
function getCommandDocument(header: MsgHeader, payload: any): any {
  if (header.opCode === OpCode.OP_QUERY) {
    return payload.query || {};
  }
  if (header.opCode === OpCode.OP_MSG) {
    const mainSection = payload.sections?.find((s: any) => s.type === 0);
    return mainSection?.doc || {};
  }
  return {};
}

/**
 * Main command router that evaluates MongoDB client requests and outputs high-fidelity mock/upstream results.
 */
async function processCommand(
  socketId: number,
  header: MsgHeader,
  payload: any,
  socket: net.Socket
): Promise<Buffer> {
  const cmdDoc = getCommandDocument(header, payload);
  const commandKeys = Object.keys(cmdDoc);
  const primaryCmd = commandKeys[0] || '';

  // Extract DB Context: OP_QUERY uses full collection name, OP_MSG uses $db field
  let dbName = 'admin';
  if (header.opCode === OpCode.OP_QUERY && payload.fullCollectionName) {
    const parts = payload.fullCollectionName.split('.');
    dbName = parts[0] || 'admin';
  } else if (cmdDoc.$db) {
    dbName = cmdDoc.$db;
  }

  console.log(
    `${CLR_INFO}[Socket #${socketId}] Incoming OpCode: ${OpCode[header.opCode]} (${header.opCode}) | DB: "${dbName}" | Command: "${primaryCmd}"${CLR_RESET}`
  );

  // Define fallback handler name for standard commands
  const primaryCmdLower = primaryCmd.toLowerCase();

  // Handshake Connection Commands: isMaster / hello / ismaster
  if (primaryCmdLower === 'ismaster' || primaryCmdLower === 'hello') {
    const handshakeResponse = {
      ismaster: true,
      isWritablePrimary: true,
      maxBsonObjectSize: 16777216,
      maxMessageSizeBytes: 48000000,
      maxWriteBatchSize: 100000,
      localTime: new Date(),
      logicalSessionTimeoutMinutes: 30,
      connectionId: socketId,
      minWireVersion: 0,
      maxWireVersion: 17, // Support modern wire specifications
      readOnly: false,
      ok: 1.0,
    };

    if (header.opCode === OpCode.OP_QUERY) {
      return buildOpReply(header.requestId, [handshakeResponse]);
    } else {
      return buildOpMsg(header.requestId, handshakeResponse);
    }
  }

  // Ping Command (Connection verification)
  if (primaryCmdLower === 'ping') {
    const res = { ok: 1.0 };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [res])
      : buildOpMsg(header.requestId, res);
  }

  // BuildInfo / buildinfo Command
  if (primaryCmdLower === 'buildinfo') {
    const buildInfoRes = {
      version: '6.0.0',
      gitVersion: 'unknown',
      sysInfo: 'unknown',
      loaderFlags: 'unknown',
      compilerFlags: 'unknown',
      allocator: 'system',
      versionArray: [6, 0, 0, 0],
      javascriptEngine: 'V8',
      bits: 64,
      debug: false,
      maxBsonObjectSize: 16777216,
      storageEngines: ['devnull', 'ephemeralForTest', 'wiredTiger'],
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [buildInfoRes])
      : buildOpMsg(header.requestId, buildInfoRes);
  }

  // GetCmdLineOpts / getcmdlineopts Command
  if (primaryCmdLower === 'getcmdlineopts') {
    const cmdLineRes = {
      argv: ['mongod'],
      parsed: {},
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [cmdLineRes])
      : buildOpMsg(header.requestId, cmdLineRes);
  }

  // WhatsMyUri Command
  if (primaryCmdLower === 'whatsmyuri') {
    const remoteIp = socket.remoteAddress || '127.0.0.1';
    const remotePort = socket.remotePort || 27017;
    const uriRes = {
      you: `${remoteIp}:${remotePort}`,
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [uriRes])
      : buildOpMsg(header.requestId, uriRes);
  }

  // ListDatabases Command
  if (primaryCmdLower === 'listdatabases') {
    const listDbsRes = {
      databases: [
        { name: 'admin', sizeOnDisk: 8192, empty: false },
        { name: 'config', sizeOnDisk: 8192, empty: false },
        { name: 'local', sizeOnDisk: 8192, empty: false },
        { name: 'sqlab', sizeOnDisk: 1048576, empty: false },
      ],
      totalSize: 1064960,
      totalSizeMb: 1,
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [listDbsRes])
      : buildOpMsg(header.requestId, listDbsRes);
  }

  // ListCollections Command
  if (primaryCmdLower === 'listcollections') {
    const tableNames = await fetchTablesListFromUpstream();
    const firstBatch = tableNames.map(name => ({
      name: name,
      type: 'collection',
      options: {},
      info: { readOnly: false }
    }));

    const listColRes = {
      cursor: {
        id: 0n,
        ns: `${dbName}.$cmd.listCollections`,
        firstBatch: firstBatch,
      },
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [listColRes])
      : buildOpMsg(header.requestId, listColRes);
  }

  // ListIndexes Command
  if (primaryCmdLower === 'listindexes') {
    const targetColl = cmdDoc.listIndexes || 'tbl_profiles';
    const listIndexesRes = {
      cursor: {
        id: 0n,
        ns: `${dbName}.${targetColl}.$cmd.listIndexes`,
        firstBatch: [
          {
            v: 2,
            key: { _id: 1 },
            name: '_id_',
          },
        ],
      },
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [listIndexesRes])
      : buildOpMsg(header.requestId, listIndexesRes);
  }

  // DBStats Command
  if (primaryCmdLower === 'dbstats') {
    const dbStatsRes = {
      db: dbName,
      collections: 1,
      views: 0,
      objects: 10,
      avgObjSize: 100,
      dataSize: 1000,
      storageSize: 4096,
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [dbStatsRes])
      : buildOpMsg(header.requestId, dbStatsRes);
  }

  // CollStats Command
  if (primaryCmdLower === 'collstats') {
    const targetColl = cmdDoc.collStats || 'tbl_profiles';
    const collStatsRes = {
      ns: `${dbName}.${targetColl}`,
      size: 1024,
      count: 10,
      avgObjSize: 100,
      storageSize: 4096,
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [collStatsRes])
      : buildOpMsg(header.requestId, collStatsRes);
  }

  // connectionStatus Command (Permissions checking for Compass)
  if (primaryCmdLower === 'connectionstatus') {
    const res = {
      authInfo: {
        authenticatedUsers: [],
        authenticatedUserRoles: [],
      },
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [res])
      : buildOpMsg(header.requestId, res);
  }

  // getParameter Command (Settings query for Compass)
  if (primaryCmdLower === 'getparameter') {
    const res: any = { ok: 1.0 };
    if (cmdDoc.featureCompatibilityVersion) {
      res.featureCompatibilityVersion = { version: '6.0' };
    }
    if (cmdDoc.saslSupportedMechs) {
      res.saslSupportedMechs = [];
    }
    // Return requested values if present or simple success
    for (const key of Object.keys(cmdDoc)) {
      if (key !== 'getParameter' && key !== 'lsid' && key !== '$db') {
        res[key] = cmdDoc[key];
      }
    }
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [res])
      : buildOpMsg(header.requestId, res);
  }

  // hostInfo Command (OS & hardware statistics)
  if (primaryCmdLower === 'hostinfo') {
    const res = {
      system: {
        currentTime: new Date(),
        hostname: 'localhost',
        cpuAddrSize: 64,
        memSize: 16384,
        numCores: 8,
        cpuArch: 'arm64',
        numaEnabled: false,
      },
      os: {
        type: 'Darwin',
        name: 'Mac OS X',
        version: '15.0.0',
      },
      extra: {
        pageSize: 4096,
      },
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [res])
      : buildOpMsg(header.requestId, res);
  }

  // serverStatus Command (Operational status statistics)
  if (primaryCmdLower === 'serverstatus') {
    const res = {
      version: '6.0.0',
      uptime: 120,
      localTime: new Date(),
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [res])
      : buildOpMsg(header.requestId, res);
  }

  // aggregate Command (Cursor structure wrapper for pipelines)
  if (primaryCmdLower === 'aggregate') {
    const collectionName = cmdDoc.aggregate;
    console.log(`[Socket #${socketId}] Intercepted aggregate command for: "${collectionName}". Payload: ${JSON.stringify(cmdDoc)}`);
    
    // Check if the aggregation pipeline is asking for collection/storage statistics ($collStats)
    const hasCollStats = Array.isArray(cmdDoc.pipeline) && cmdDoc.pipeline.some((stage: any) => stage && stage.$collStats);
    
    const firstBatch = hasCollStats 
      ? [{
          storageStats: {
            capped: false,
            count: 100,
            size: 10240,
            storageSize: 40960,
            totalIndexSize: 8192,
            freeStorageSize: 4096,
            avgObjSize: 102,
            nindexes: 1
          }
        }]
      : [];

    const res = {
      cursor: {
        firstBatch: firstBatch,
        id: 0n,
        ns: `${dbName}.${collectionName}`,
      },
      ok: 1.0,
    };
    return header.opCode === OpCode.OP_QUERY
      ? buildOpReply(header.requestId, [res])
      : buildOpMsg(header.requestId, res);
  }

  // FIND QUERY (The central interception point for modern drivers/Compass)
  if (primaryCmdLower === 'find') {
    const collectionName = cmdDoc.find;
    const filter = cmdDoc.filter || {};
    
    console.log(`${CLR_QUERY}[Socket #${socketId}] INTERCEPTED Find Command for collection: "${collectionName}"${CLR_RESET}`);
    console.log(`${CLR_QUERY}[Socket #${socketId}] BSON filter details: ${JSON.stringify(filter)}${CLR_RESET}`);

    // Extract search constraints (specifically 'phone')
    const phoneFilter = extractPhoneFilter(filter);
    if (phoneFilter) {
      console.log(`${CLR_SUCCESS}[Socket #${socketId}] Extracted phone filter value: "${phoneFilter}"${CLR_RESET}`);
    } else {
      console.log(`${CLR_INFO}[Socket #${socketId}] No phone filter found. Defaulting to general fetch query.${CLR_RESET}`);
    }

    // Call upstream SQL API or return local mock simulation
    const startTime = Date.now();
    const documents = await fetchDataFromUpstream(collectionName, filter);
    const duration = Date.now() - startTime;
    console.log(`${CLR_SUCCESS}[Socket #${socketId}] Upstream query resolved in ${duration}ms. Returned ${documents.length} rows.${CLR_RESET}`);

    // Build the query cursor response matching MongoDB specifications
    const findResponse = {
      cursor: {
        firstBatch: documents,
        id: 0n, // End of cursor batch stream
        ns: `${dbName}.${collectionName}`,
      },
      ok: 1.0,
    };

    if (header.opCode === OpCode.OP_QUERY) {
      return buildOpReply(header.requestId, [findResponse]);
    } else {
      return buildOpMsg(header.requestId, findResponse);
    }
  }

  // Fallback handler for unhandled commands (ensures client doesn't freeze or drop connection)
  console.log(`${CLR_WARN}[Socket #${socketId}] Handled stub for command: "${primaryCmd}". Payload: ${JSON.stringify(cmdDoc)}${CLR_RESET}`);
  const genericResponse = { ok: 1.0 };
  
  if (header.opCode === OpCode.OP_QUERY) {
    return buildOpReply(header.requestId, [genericResponse]);
  } else {
    return buildOpMsg(header.requestId, genericResponse);
  }
}

/**
 * Main Network Entrypoint using Node TCP Socket
 */
const server = net.createServer((socket) => {
  const socketId = ++socketCounter;
  console.log(
    `${CLR_CONN}[Network] Connection opened from ${socket.remoteAddress}:${socket.remotePort} (Assigned Socket ID: #${socketId})${CLR_RESET}`
  );

  // Maintain buffer state per TCP socket stream
  let connectionBuffer = Buffer.alloc(0);

  socket.on('data', async (chunk) => {
    // Concatenate incoming chunk
    connectionBuffer = Buffer.concat([connectionBuffer, chunk]);

    try {
      while (true) {
        // Attempt to extract next frame
        const { frame, remaining } = readNextFrame(connectionBuffer);

        if (!frame) {
          // Message frame incomplete. Wait for next TCP 'data' event.
          connectionBuffer = remaining;
          break;
        }

        // Complete frame found, advance stream buffer pointer
        connectionBuffer = remaining;

        // Parse and process MongoDB packet
        const { header, payload } = parseMessage(frame);
        
        try {
          const responseBuffer = await processCommand(socketId, header, payload, socket);
          socket.write(responseBuffer);
        } catch (err: any) {
          console.error(`${CLR_WARN}[Socket #${socketId}] Error executing command: ${err.message}${CLR_RESET}`);
          
          // Respond with MongoDB Error Document to gracefully notify client
          const errorDoc = {
            ok: 0.0,
            errmsg: err.message || 'Internal TCP command handler exception',
            code: 139, // internal standard error code
          };
          
          const errorBuffer = header.opCode === OpCode.OP_QUERY
            ? buildOpReply(header.requestId, [errorDoc])
            : buildOpMsg(header.requestId, errorDoc);
            
          socket.write(errorBuffer);
        }
      }
    } catch (err: any) {
      console.error(`${CLR_WARN}[Socket #${socketId}] Critical TCP stream decoding error: ${err.message}${CLR_RESET}`);
      socket.destroy();
    }
  });

  socket.on('end', () => {
    console.log(`${CLR_CONN}[Network] Client disconnected gracefully (Socket ID: #${socketId})${CLR_RESET}`);
  });

  socket.on('error', (err) => {
    console.error(`${CLR_CONN}[Network] Socket ID #${socketId} network error: ${err.message}${CLR_RESET}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${CLR_HEADER}================================================================${CLR_RESET}`);
  console.log(`${CLR_SUCCESS}🚀 Fake MongoDB Wire Protocol Server is listening on port ${PORT}${CLR_RESET}`);
  console.log(`${CLR_INFO}👉 Connect your MongoDB Compass to: mongodb://127.0.0.1:${PORT}/sqlab${CLR_RESET}`);
  console.log(`${CLR_INFO}👉 To test filtering: search by phone field in collection "tbl_profiles"${CLR_RESET}`);
  console.log(`${CLR_HEADER}================================================================${CLR_RESET}\n`);

  // Pre-fetch all tables in the schema in the background to warm up cache immediately
  console.log(`${CLR_INFO}[Warmup] Pre-fetching tables list from Trino in the background...${CLR_RESET}`);
  fetchTablesListFromUpstream().catch(err => {
    console.error(`[Warmup] Failed to pre-fetch table list: ${err.message}`);
  });
});
