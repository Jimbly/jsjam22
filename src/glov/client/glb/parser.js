// Derived from (MIT Licensed) https://github.com/uber-web/loaders.gl/tree/master/modules/gltf
/* eslint-env browser */

/* eslint-disable import/order */
const assert = require('assert');

const { unpackGLBBuffers } = require('./unpack-glb-buffers.js');
const { unpackBinaryJson } = require('./unpack-binary-json.js');

function padTo4Bytes(byteLength) {
  return (byteLength + 3) & ~3;
}

const decode_utf8 = require('./decode-utf8.js');

const {
  ATTRIBUTE_TYPE_TO_COMPONENTS,
  ATTRIBUTE_COMPONENT_TYPE_TO_BYTE_SIZE,
  ATTRIBUTE_COMPONENT_TYPE_TO_ARRAY
} = require('./gltf-type-utils.js');

const MAGIC_glTF = 0x676c5446; // glTF in Big-Endian ASCII

const GLB_FILE_HEADER_SIZE = 12;
const GLB_CHUNK_HEADER_SIZE = 8;

const GLB_CHUNK_TYPE_JSON = 0x4e4f534a;
const GLB_CHUNK_TYPE_BIN = 0x004e4942;

const LE = true; // Binary GLTF is little endian.
const BE = false; // Magic needs to be written as BE

// https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#glb-file-format-specification
function GLBParser() {
  // Result
  this.binaryByteOffset = null;
  this.packedJson = null;
  this.json = null;
}

function parseBinary(self) {
  // GLB Header
  const dataView = new DataView(self.glbArrayBuffer);
  const magic1 = dataView.getUint32(0, BE); // Magic number (the ASCII string 'glTF').
  const version = dataView.getUint32(4, LE); // Version 2 of binary glTF container format
  const fileLength = dataView.getUint32(8, LE); // Total byte length of generated file

  let valid = magic1 === MAGIC_glTF;
  if (!valid) {
    console.warn('Invalid GLB magic string');
  }

  assert(version === 2, `Invalid GLB version ${version}. Only .glb v2 supported`);
  assert(fileLength > 20);

  // Write the JSON chunk
  const jsonChunkLength = dataView.getUint32(12, LE); // Byte length of json chunk
  const jsonChunkFormat = dataView.getUint32(16, LE); // Chunk format as uint32

  valid = jsonChunkFormat === GLB_CHUNK_TYPE_JSON || jsonChunkFormat === 0; // Back compat
  assert(valid, `JSON chunk format ${jsonChunkFormat}`);

  // Create a "view" of the binary encoded JSON data
  const jsonChunkOffset = GLB_FILE_HEADER_SIZE + GLB_CHUNK_HEADER_SIZE; // First headers: 20 bytes
  const jsonChunk = new Uint8Array(self.glbArrayBuffer, jsonChunkOffset, jsonChunkLength);

  // Decode the JSON binary array into clear text
  const jsonText = decode_utf8.decode(jsonChunk);

  // Parse the JSON text into a JavaScript data structure
  self.json = JSON.parse(jsonText);

  // TODO - BIN chunk can be optional
  const binaryChunkStart = jsonChunkOffset + padTo4Bytes(jsonChunkLength);
  self.binaryByteOffset = binaryChunkStart + GLB_CHUNK_HEADER_SIZE;

  const binChunkFormat = dataView.getUint32(binaryChunkStart + 4, LE); // Chunk format as uint32
  valid = binChunkFormat === GLB_CHUNK_TYPE_BIN || binChunkFormat === 1; // Back compat
  assert(valid, `BIN chunk format ${binChunkFormat}`);

  return {
    arrayBuffer: self.glbArrayBuffer,
    binaryByteOffset: self.binaryByteOffset,
    json: self.json
  };
}

function parseInternal(self) {
  const result = parseBinary(self);
  self.packedJson = result.json;
  self.unpackedBuffers = unpackGLBBuffers(self.glbArrayBuffer, self.json, self.binaryByteOffset);
  self.json = unpackBinaryJson(self.json, self.unpackedBuffers);
}

GLBParser.prototype.parseSync = function (arrayBuffer) {
  // Input
  this.glbArrayBuffer = arrayBuffer;

  // Only parse once
  if (this.json === null && this.binaryByteOffset === null) {
    parseInternal(this);
  }
  return this;
};

// Return the gltf JSON and the original arrayBuffer
GLBParser.prototype.parse = function (arrayBuffer) {
  return this.parseSync(arrayBuffer);
};

// Returns application JSON data stored in `key`
GLBParser.prototype.getApplicationData = function (key) {
  return this.json[key];
};

// Returns JSON envelope
GLBParser.prototype.getJSON = function () {
  return this.json;
};

// Return binary chunk
GLBParser.prototype.getArrayBuffer = function () {
  return this.glbArrayBuffer;
};

// Return index into binary chunk
GLBParser.prototype.getBinaryByteOffset = function () {
  return this.binaryByteOffset;
};

// Unpacks a bufferview into a new Uint8Array that is a view into the binary chunk
GLBParser.prototype.getBufferView = function (glTFBufferView) {
  const byteOffset = (glTFBufferView.byteOffset || 0) + this.binaryByteOffset;
  return new Uint8Array(this.glbArrayBuffer, byteOffset, glTFBufferView.byteLength);
};

// Unpacks a glTF accessor into a new typed array that is a view into the binary chunk
GLBParser.prototype.getBuffer = function (glTFAccessor) {
  // Decode the glTF accessor format
  const ArrayType = ATTRIBUTE_COMPONENT_TYPE_TO_ARRAY[glTFAccessor.componentType];
  const components = ATTRIBUTE_TYPE_TO_COMPONENTS[glTFAccessor.type];
  const bytesPerComponent = ATTRIBUTE_COMPONENT_TYPE_TO_BYTE_SIZE[glTFAccessor.componentType];
  const length = glTFAccessor.count * components;
  const byteLength = glTFAccessor.count * components * bytesPerComponent;

  // Get the boundaries of the binary sub-chunk for this bufferView
  const glTFBufferView = this.json.bufferViews[glTFAccessor.bufferView];
  assert(byteLength >= 0 && glTFAccessor.byteOffset + byteLength <= glTFBufferView.byteLength);

  const byteOffset = glTFBufferView.byteOffset + this.binaryByteOffset + glTFAccessor.byteOffset;
  return new ArrayType(this.glbArrayBuffer, byteOffset, length);
};

// Unpacks an image into an HTML image
GLBParser.prototype.getImageData = function (glTFImage) {
  return {
    typedArray: this.getBufferView(glTFImage.bufferView),
    mimeType: glTFImage.mimeType || 'image/jpeg'
  };
};

GLBParser.prototype.getImage = function (glTFImage) {
  const arrayBufferView = this.getBufferView(glTFImage.bufferView);
  const mimeType = glTFImage.mimeType || 'image/jpeg';
  const blob = new Blob([arrayBufferView], { type: mimeType });
  const urlCreator = window.URL || window.webkitURL;
  const imageUrl = urlCreator.createObjectURL(blob);
  const img = new Image();
  img.src = imageUrl;
  return img;
};

// GLBParser.prototype.getImageAsync = function (glTFImage) {
//   return new Promise(resolve => {
//     const arrayBufferView = this.getBufferView(glTFImage.bufferView);
//     const mimeType = glTFImage.mimeType || 'image/jpeg';
//     const blob = new Blob([arrayBufferView], {type: mimeType});
//     const urlCreator = window.URL || window.webkitURL;
//     const imageUrl = urlCreator.createObjectURL(blob);
//     const img = new Image();
//     img.onload = () => resolve(img);
//     img.src = imageUrl;
//   });
// };

module.exports = GLBParser;
GLBParser.parse = function (data) {
  let parser = new GLBParser();
  return parser.parse(data);
};
