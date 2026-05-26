import { BSON } from 'bson';

// Sequence generator for Request IDs (as required by the protocol)
let globalRequestId = 1;
export function generateRequestId(): number {
  return globalRequestId++;
}

// OpCodes supported/observed in the MongoDB wire protocol
export enum OpCode {
  OP_REPLY = 1,
  OP_UPDATE = 2001,
  OP_INSERT = 2002,
  RESERVED = 2003,
  OP_QUERY = 2004,
  OP_GET_MORE = 2005,
  OP_DELETE = 2006,
  OP_KILL_CURSORS = 2007,
  OP_COMPRESSED = 2012,
  OP_MSG = 2013,
}

export interface MsgHeader {
  messageLength: number;
  requestId: number;
  responseTo: number;
  opCode: OpCode;
}

export interface OpQueryPayload {
  flags: number;
  fullCollectionName: string;
  numberToSkip: number;
  numberToReturn: number;
  query: any;
  returnFieldsSelector?: any;
}

export type OpMsgSection =
  | { type: 0; doc: any }
  | { type: 1; identifier: string; docs: any[] };

export interface OpMsgPayload {
  flagBits: number;
  sections: OpMsgSection[];
  checksum?: number;
}

/**
 * Extracts a complete message from the incoming stream buffer if available.
 * Returns the parsed message buffer and the remaining buffer.
 */
export function readNextFrame(buffer: Buffer): { frame: Buffer | null; remaining: Buffer } {
  if (buffer.length < 4) {
    return { frame: null, remaining: buffer };
  }

  // Every message starts with a 32-bit little-endian integer indicating total size in bytes
  const messageLength = buffer.readInt32LE(0);

  if (messageLength < 16 || messageLength > 48 * 1024 * 1024) {
    // Protocol error or invalid length. Recover by clearing buffer to prevent memory leakage.
    console.error(`Invalid message length detected: ${messageLength}. Resetting buffer.`);
    return { frame: null, remaining: Buffer.alloc(0) };
  }

  if (buffer.length < messageLength) {
    // Message is still incomplete
    return { frame: null, remaining: buffer };
  }

  const frame = buffer.subarray(0, messageLength);
  const remaining = buffer.subarray(messageLength);

  return { frame, remaining };
}

/**
 * Parses a complete message frame buffer into its header and payload structure.
 */
export function parseMessage(frame: Buffer): { header: MsgHeader; payload: any } {
  if (frame.length < 16) {
    throw new Error('Message frame is too short (must be at least 16 bytes)');
  }

  const header: MsgHeader = {
    messageLength: frame.readInt32LE(0),
    requestId: frame.readInt32LE(4),
    responseTo: frame.readInt32LE(8),
    opCode: frame.readInt32LE(12) as OpCode,
  };

  const payloadBuffer = frame.subarray(16);

  if (header.opCode === OpCode.OP_QUERY) {
    const payload = parseOpQuery(payloadBuffer);
    return { header, payload };
  } else if (header.opCode === OpCode.OP_MSG) {
    const payload = parseOpMsg(payloadBuffer);
    return { header, payload };
  } else {
    return { header, payload: { raw: payloadBuffer } };
  }
}

/**
 * Parses the payload of an OP_QUERY message.
 */
function parseOpQuery(buffer: Buffer): OpQueryPayload {
  if (buffer.length < 12) {
    throw new Error('OP_QUERY payload is too short');
  }

  const flags = buffer.readInt32LE(0);
  
  // Find null-terminated collection name cstring
  let colNameEnd = 4;
  while (colNameEnd < buffer.length && buffer[colNameEnd] !== 0) {
    colNameEnd++;
  }
  const fullCollectionName = buffer.toString('utf8', 4, colNameEnd);
  
  let offset = colNameEnd + 1; // skip null byte
  
  if (offset + 8 > buffer.length) {
    throw new Error('OP_QUERY payload ended abruptly after collection name');
  }

  const numberToSkip = buffer.readInt32LE(offset);
  const numberToReturn = buffer.readInt32LE(offset + 4);
  offset += 8;

  const queryDocBuffer = buffer.subarray(offset);
  let query: any = {};
  let returnFieldsSelector: any = undefined;

  if (queryDocBuffer.length > 0) {
    try {
      const docSize = queryDocBuffer.readInt32LE(0);
      if (docSize <= queryDocBuffer.length) {
        query = BSON.deserialize(queryDocBuffer.subarray(0, docSize));
        
        const remainingOffset = docSize;
        if (remainingOffset + 4 <= queryDocBuffer.length) {
          const selectorSize = queryDocBuffer.readInt32LE(remainingOffset);
          if (remainingOffset + selectorSize <= queryDocBuffer.length) {
            returnFieldsSelector = BSON.deserialize(
              queryDocBuffer.subarray(remainingOffset, remainingOffset + selectorSize)
            );
          }
        }
      }
    } catch (err: any) {
      console.error('[Wire] Error deserializing BSON for OP_QUERY query doc:', err.message);
    }
  }

  return {
    flags,
    fullCollectionName,
    numberToSkip,
    numberToReturn,
    query,
    returnFieldsSelector,
  };
}

/**
 * Parses the payload of an OP_MSG message.
 */
function parseOpMsg(buffer: Buffer): OpMsgPayload {
  if (buffer.length < 4) {
    throw new Error('OP_MSG payload is too short');
  }

  const flagBits = buffer.readUInt32LE(0);
  const sections: OpMsgSection[] = [];
  let offset = 4;

  const isChecksumPresent = (flagBits & 0x01) !== 0;
  const payloadLimit = isChecksumPresent ? buffer.length - 4 : buffer.length;

  while (offset < payloadLimit) {
    const sectionType = buffer[offset];
    offset++;

    if (sectionType === 0) {
      // Type 0: Single BSON document
      if (offset + 4 > payloadLimit) {
        break;
      }
      const docSize = buffer.readInt32LE(offset);
      if (offset + docSize > payloadLimit) {
        break;
      }
      const docBuffer = buffer.subarray(offset, offset + docSize);
      const doc = BSON.deserialize(docBuffer);
      sections.push({ type: 0, doc });
      offset += docSize;
    } else if (sectionType === 1) {
      // Type 1: Document sequence
      if (offset + 4 > payloadLimit) {
        break;
      }
      const sectionSize = buffer.readInt32LE(offset);
      if (offset + sectionSize > payloadLimit) {
        break;
      }

      // Read cstring sequence identifier
      let cstringEnd = offset + 4;
      while (cstringEnd < offset + sectionSize && buffer[cstringEnd] !== 0) {
        cstringEnd++;
      }
      const identifier = buffer.toString('utf8', offset + 4, cstringEnd);
      
      let docOffset = cstringEnd + 1;
      const docs: any[] = [];

      while (docOffset < offset + sectionSize) {
        const docSize = buffer.readInt32LE(docOffset);
        const docBuffer = buffer.subarray(docOffset, docOffset + docSize);
        docs.push(BSON.deserialize(docBuffer));
        docOffset += docSize;
      }

      sections.push({ type: 1, identifier, docs });
      offset += sectionSize;
    } else {
      console.warn(`[Wire] Unknown Section Type encountered: ${sectionType} at offset ${offset - 1}`);
      break;
    }
  }

  let checksum: number | undefined;
  if (isChecksumPresent && offset + 4 <= buffer.length) {
    checksum = buffer.readUInt32LE(offset);
  }

  return {
    flagBits,
    sections,
    checksum,
  };
}

/**
 * Builds a legacy OP_REPLY buffer to reply to an OP_QUERY handshake.
 */
export function buildOpReply(responseTo: number, documents: any[]): Buffer {
  const serializedDocs = documents.map(doc => BSON.serialize(doc));
  const docsBuffer = Buffer.concat(serializedDocs);

  const headerLength = 16;
  const replyFieldsLength = 20; // flags (4) + cursorID (8) + startingFrom (4) + numberReturned (4)
  const messageLength = headerLength + replyFieldsLength + docsBuffer.length;

  const responseBuffer = Buffer.alloc(messageLength);

  // 1. Write Header
  responseBuffer.writeInt32LE(messageLength, 0);
  responseBuffer.writeInt32LE(generateRequestId(), 4);
  responseBuffer.writeInt32LE(responseTo, 8);
  responseBuffer.writeInt32LE(OpCode.OP_REPLY, 12);

  // 2. Write OP_REPLY Fields
  responseBuffer.writeInt32LE(0, 16); // responseFlags
  responseBuffer.writeBigInt64LE(0n, 20); // cursorID = 0 (no more data/finished cursor)
  responseBuffer.writeInt32LE(0, 28); // startingFrom
  responseBuffer.writeInt32LE(documents.length, 32); // numberReturned

  // 3. Write BSON Documents
  docsBuffer.copy(responseBuffer, 36);

  return responseBuffer;
}

/**
 * Builds a modern OP_MSG response buffer.
 */
export function buildOpMsg(responseTo: number, responseDoc: any): Buffer {
  const docBuffer = BSON.serialize(responseDoc);

  const headerLength = 16;
  const flagBitsLength = 4;
  const sectionTypeLength = 1;
  const messageLength = headerLength + flagBitsLength + sectionTypeLength + docBuffer.length;

  const responseBuffer = Buffer.alloc(messageLength);

  // 1. Write Header
  responseBuffer.writeInt32LE(messageLength, 0);
  responseBuffer.writeInt32LE(generateRequestId(), 4);
  responseBuffer.writeInt32LE(responseTo, 8);
  responseBuffer.writeInt32LE(OpCode.OP_MSG, 12);

  // 2. Write flagBits
  responseBuffer.writeUInt32LE(0, 16);

  // 3. Write sectionType (0 = BSON Body)
  responseBuffer[20] = 0;

  // 4. Copy the serialized BSON body
  docBuffer.copy(responseBuffer, 21);

  return responseBuffer;
}
