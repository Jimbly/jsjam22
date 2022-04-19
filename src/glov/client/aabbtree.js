// Copyright (c) 2009-2014 Turbulenz Limited
// Used under MIT License
// Modified by Jimb Esser
/* eslint no-underscore-dangle:off, one-var:off, sort-vars:off, max-len:off, consistent-return:off, no-bitwise:off */

/**
 * General layout
 *   Nodes are either a leaf (has .externalNode) or container (have children, has .escapeNodeOffset > 1)
 *   The tree's .nodes array is built up of:
 *     container with escapeNodeOffset followed by 1-4 leaf nodes
 *   So, walking the tree is:
 *     look at node
 *       if it has .externalNode, it's a leaf, otherwise
 *       if we want to include or skip all children, just consume from to escapeNode
 *       if we want to recurse, while < escapeNode, look at child node, then advance to child node's escape
 */

const assert = require('assert');

const REMOVED_NODE = -1;

//
// AABBTreeNode
//
function AABBTreeNode(extents, escapeNodeOffset, externalNode) {
  this.escapeNodeOffset = escapeNodeOffset;
  this.externalNode = externalNode;
  this.extents = extents;

  return this;
}
AABBTreeNode.prototype.isLeaf = function () {
  return Boolean(this.externalNode);
};

AABBTreeNode.prototype.reset = function (minX, minY, minZ, maxX, maxY, maxZ, escapeNodeOffset, externalNode) {
  this.escapeNodeOffset = escapeNodeOffset;
  this.externalNode = externalNode;
  let oldExtents = this.extents;
  oldExtents[0] = minX;
  oldExtents[1] = minY;
  oldExtents[2] = minZ;
  oldExtents[3] = maxX;
  oldExtents[4] = maxY;
  oldExtents[5] = maxZ;
};

AABBTreeNode.prototype.clear = function () {
  this.escapeNodeOffset = 1;
  this.externalNode = undefined;
  let oldExtents = this.extents;
  let maxNumber = Number.MAX_VALUE;
  oldExtents[0] = maxNumber;
  oldExtents[1] = maxNumber;
  oldExtents[2] = maxNumber;
  oldExtents[3] = -maxNumber;
  oldExtents[4] = -maxNumber;
  oldExtents[5] = -maxNumber;
};

// Constructor function
AABBTreeNode.create = function (extents, escapeNodeOffset, externalNode) {
  return new AABBTreeNode(extents, escapeNodeOffset, externalNode);
};

const NUM_NODES_LEAF = 32;

//
// AABBTree
//
let last_spatial_id = 0;
function AABBTree(params) {
  this.nodes = [];
  this.endNode = 0;
  this.needsRebuild = false;
  this.needsRebound = false;
  this.numAdds = 0;
  this.numUpdates = 0;
  this.numExternalNodes = 0;
  this.startUpdate = 0x7FFFFFFF;
  this.endUpdate = -0x7FFFFFFF;
  this.highQuality = Boolean(params.highQuality);
  this.name = params.name;
  this.log_rebuilds = params.log_rebuilds;
  this.nodesStack = new Array(32);
  this.spat_id = `_spat${++last_spatial_id}`;
}

const nodesPoolAllocationSize = 128;
let nodesPool = [];

AABBTree.allocateNode = function () {
  if (!nodesPool.length) {
    // Allocate a bunch of nodes in one go
    // JE: Don't use one Float32Array, that leaks something awful in the worst case
    // let extentsArray = new Float32Array(nodesPoolAllocationSize * 6);
    // let extentsArrayIndex = 0;
    for (let n = 0; n < nodesPoolAllocationSize; n++) {
      // let extents = extentsArray.subarray(extentsArrayIndex, (extentsArrayIndex + 6));
      // extentsArrayIndex += 6;
      let extents = new Float32Array(6);
      nodesPool[n] = AABBTreeNode.create(extents, 1, undefined);
    }
  }
  return nodesPool.pop();
};

AABBTree.releaseNode = function (node) {
  if (nodesPool.length < nodesPoolAllocationSize) {
    node.clear();
    nodesPool.push(node);
  }
};

AABBTree.recycleNodes = function (nodes, start) {
  let numNodes = nodes.length;
  let n;
  for (n = start; n < numNodes; n++) {
    let node = nodes[n];
    if (node) {
      this.releaseNode(node);
    }
  }
  nodes.length = start;
};

AABBTree.prototype.add = function (externalNode, extents) {
  let endNode = this.endNode;
  externalNode[this.spat_id] = endNode;

  let node = AABBTree.allocateNode();
  node.escapeNodeOffset = 1;
  node.externalNode = externalNode;
  let copyExtents = node.extents;
  copyExtents[0] = extents[0];
  copyExtents[1] = extents[1];
  copyExtents[2] = extents[2];
  copyExtents[3] = extents[3];
  copyExtents[4] = extents[4];
  copyExtents[5] = extents[5];

  this.nodes[endNode] = node;
  this.endNode = (endNode + 1);
  this.numAdds++;
  this.numExternalNodes++;
  if (this.numAdds > this.numExternalNodes * 0.20 || this.numAdds > 100) {
    this.needsRebuild = true;
  }
};

AABBTree.prototype.remove = function (externalNode) {
  let index = externalNode[this.spat_id];
  if (index !== undefined) {
    if (this.numExternalNodes > 1) {
      let nodes = this.nodes;
      assert(nodes[index].externalNode === externalNode);

      // JE: not doing this, so that we can efficiently add to the end,
      //   otherwise this code needs to clean up parents' escapeNodeOffsets
      // let endNode = this.endNode;
      // if ((index + 1) >= endNode) {
      //   nodes[index].clear();
      //   while (!nodes[endNode - 1].externalNode) {
      //     endNode--;
      //   }
      //   this.endNode = endNode;
      // } else {
      nodes[index].externalNode = REMOVED_NODE;
      // JE: don't seem to need this - we just trigger a rebuild if we ever
      //   do a getVisibleNodes that has to skip too much
      // this.numUpdates++;
      // // force a rebuild when things change too much
      // if (this.numUpdates > (3 * this.numExternalNodes)) {
      //   this.needsRebuild = true;
      // }

      // nodes[index].clear();
      // this.needsRebuild = true;
      // }
      this.numExternalNodes--;
    } else {
      this.clear();
    }

    externalNode[this.spat_id] = undefined;
  }
};

AABBTree.prototype.findParent = function (nodeIndex) {
  let nodes = this.nodes;
  let parentIndex = nodeIndex;
  let nodeDist = 0;
  let parent;
  do {
    parentIndex--;
    nodeDist++;
    parent = nodes[parentIndex];
    // JE: Add `parent` check here, otherwise any root element fails
  } while (parent && parent.escapeNodeOffset <= nodeDist);
  return parent;
};

AABBTree.prototype.update = function (externalNode, extents) {
  let index = externalNode[this.spat_id];
  if (index !== undefined) {
    let min0 = extents[0];
    let min1 = extents[1];
    let min2 = extents[2];
    let max0 = extents[3];
    let max1 = extents[4];
    let max2 = extents[5];

    let needsRebuild = this.needsRebuild;
    let needsRebound = this.needsRebound;
    let nodes = this.nodes;
    let node = nodes[index];
    assert(node.externalNode === externalNode);
    let nodeExtents = node.extents;

    let doUpdate = (needsRebuild || needsRebound ||
      nodeExtents[0] > min0 || nodeExtents[1] > min1 || nodeExtents[2] > min2 ||
      nodeExtents[3] < max0 || nodeExtents[4] < max1 || nodeExtents[5] < max2);

    nodeExtents[0] = min0;
    nodeExtents[1] = min1;
    nodeExtents[2] = min2;
    nodeExtents[3] = max0;
    nodeExtents[4] = max1;
    nodeExtents[5] = max2;

    if (doUpdate) {
      if (!needsRebuild && nodes.length > 1) {
        this.numUpdates++;
        if (this.startUpdate > index) {
          this.startUpdate = index;
        }
        if (this.endUpdate < index) {
          this.endUpdate = index;
        }
        if (!needsRebound) {
          // force a rebound when things change too much
          if ((2 * this.numUpdates) > this.numExternalNodes) {
            this.needsRebound = true;
          } else {
            let parent = this.findParent(index);
            if (parent) {
              let parentExtents = parent.extents;
              if (parentExtents[0] > min0 || parentExtents[1] > min1 || parentExtents[2] > min2 ||
                parentExtents[3] < max0 || parentExtents[4] < max1 || parentExtents[5] < max2) {
                this.needsRebound = true;
              }
            }
          }
        } else {
          // force a rebuild when things change too much
          if (this.numUpdates > (3 * this.numExternalNodes)) {
            this.needsRebuild = true;
            this.numAdds = this.numUpdates;
          }
        }
      }
    }
  } else {
    this.add(externalNode, extents);
  }
};

AABBTree.prototype.needsFinalize = function () {
  return (this.needsRebuild || this.needsRebound);
};

AABBTree.prototype.finalize = function () {
  if (this.needsRebuild) {
    this.rebuild();
    return true;
  } else if (this.needsRebound) {
    this.rebound();
    return true;
  }
  return false;
};

AABBTree.prototype.rebound = function () {
  let nodes = this.nodes;
  if (nodes.length > 1) {
    let startUpdateNodeIndex = this.startUpdate;
    let endUpdateNodeIndex = this.endUpdate;

    let nodesStack = this.nodesStack;
    let numNodesStack = 0;
    let topNodeIndex = 0;
    for (; ;) {
      let topNode = nodes[topNodeIndex];
      let currentNodeIndex = topNodeIndex;
      let currentEscapeNodeIndex = (topNodeIndex + topNode.escapeNodeOffset);
      let nodeIndex = (topNodeIndex + 1);
      let node;
      do {
        node = nodes[nodeIndex];
        let escapeNodeIndex = (nodeIndex + node.escapeNodeOffset);
        if (nodeIndex < endUpdateNodeIndex) {
          if (!node.externalNode) {
            if (escapeNodeIndex > startUpdateNodeIndex) {
              nodesStack[numNodesStack] = topNodeIndex;
              numNodesStack++;
              topNodeIndex = nodeIndex;
            }
          }
        } else {
          break;
        }
        nodeIndex = escapeNodeIndex;
      } while (nodeIndex < currentEscapeNodeIndex);

      if (topNodeIndex === currentNodeIndex) {
        nodeIndex = (topNodeIndex + 1); // First child
        node = nodes[nodeIndex];

        let extents = node.extents;
        let minX = extents[0];
        let minY = extents[1];
        let minZ = extents[2];
        let maxX = extents[3];
        let maxY = extents[4];
        let maxZ = extents[5];

        nodeIndex += node.escapeNodeOffset;
        while (nodeIndex < currentEscapeNodeIndex) {
          node = nodes[nodeIndex];
          extents = node.extents;

          if (minX > extents[0]) {
            minX = extents[0];
          }
          if (minY > extents[1]) {
            minY = extents[1];
          }
          if (minZ > extents[2]) {
            minZ = extents[2];
          }
          if (maxX < extents[3]) {
            maxX = extents[3];
          }
          if (maxY < extents[4]) {
            maxY = extents[4];
          }
          if (maxZ < extents[5]) {
            maxZ = extents[5];
          }

          nodeIndex += node.escapeNodeOffset;
        }

        extents = topNode.extents;
        extents[0] = minX;
        extents[1] = minY;
        extents[2] = minZ;
        extents[3] = maxX;
        extents[4] = maxY;
        extents[5] = maxZ;

        endUpdateNodeIndex = topNodeIndex;

        if (numNodesStack > 0) {
          numNodesStack--;
          topNodeIndex = nodesStack[numNodesStack];
        } else {
          break;
        }
      }
    }
  }

  this.needsRebuild = false;
  this.needsRebound = false;
  this.numAdds = 0;

  //this.numUpdates = 0;
  this.startUpdate = 0x7FFFFFFF;
  this.endUpdate = -0x7FFFFFFF;
};

AABBTree.prototype.rebuild = function () {
  if (this.numExternalNodes > 0) {
    let start = Date.now();
    let nodes = this.nodes;

    let buildNodes;
    let numBuildNodes;

    if (this.numExternalNodes === nodes.length) {
      buildNodes = nodes;
      numBuildNodes = nodes.length;
      nodes = [];
      this.nodes = nodes;
    } else {
      buildNodes = [];
      buildNodes.length = this.numExternalNodes;
      numBuildNodes = 0;
      let endNodeIndex = this.endNode;
      for (let n = 0; n < endNodeIndex; n++) {
        let currentNode = nodes[n];
        if (currentNode.externalNode) {
          if (currentNode.externalNode !== REMOVED_NODE) {
            nodes[n] = undefined;
            buildNodes[numBuildNodes] = currentNode;
            numBuildNodes++;
          }
        }
      }
      if (buildNodes.length > numBuildNodes) {
        buildNodes.length = numBuildNodes;
      }
    }

    let rootNode;
    if (numBuildNodes > 1) {
      if (numBuildNodes > NUM_NODES_LEAF && this.numAdds > 0) {
        if (this.highQuality) {
          this._sortNodesHighQuality(buildNodes);
        } else {
          this._sortNodes(buildNodes);
        }
      }

      let predictedNumNodes = this._predictNumNodes(0, numBuildNodes, 0);
      if (nodes.length > predictedNumNodes) {
        AABBTree.recycleNodes(nodes, predictedNumNodes);
      }

      this._recursiveBuild(buildNodes, 0, numBuildNodes, 0);

      let endNodeIndex = nodes[0].escapeNodeOffset;
      if (nodes.length > endNodeIndex) {
        AABBTree.recycleNodes(nodes, endNodeIndex);
      }
      this.endNode = endNodeIndex;
    } else {
      rootNode = buildNodes[0];
      rootNode.externalNode[this.spat_id] = 0;
      nodes.length = 1;
      nodes[0] = rootNode;
      this.endNode = 1;
    }
    buildNodes = null;
    let dt = Date.now() - start;
    if (this.log_rebuilds && dt > 1) {
      console.log(`AABBTree.rebuild(${this.name}) in ${dt}ms`);
    }
  }

  this.needsRebuild = false;
  this.needsRebound = false;
  this.numAdds = 0;
  this.numUpdates = 0;
  this.startUpdate = 0x7FFFFFFF;
  this.endUpdate = -0x7FFFFFFF;
};

function medianFn(a, b, c) {
  if (a < b) {
    if (b < c) {
      return b;
    } else if (a < c) {
      return c;
    } else {
      return a;
    }
  } else if (a < c) {
    return a;
  } else if (b < c) {
    return c;
  }
  return b;
}

function nthElement(nodes, first, nth, last, getkey) {

  while ((last - first) > 8) {
    let midValue = medianFn(getkey(nodes[first]),
      getkey(nodes[first + ((last - first) >> 1)]),
      getkey(nodes[last - 1]));

    let firstPos = first;
    let lastPos = last;
    let midPos;
    for (; ; firstPos++) {
      while (getkey(nodes[firstPos]) < midValue) {
        firstPos++;
      }

      do {
        lastPos--;
      } while (midValue < getkey(nodes[lastPos]));

      if (firstPos >= lastPos) {
        midPos = firstPos;
        break;
      } else {
        let temp = nodes[firstPos];
        nodes[firstPos] = nodes[lastPos];
        nodes[lastPos] = temp;
      }
    }

    if (midPos <= nth) {
      first = midPos;
    } else {
      last = midPos;
    }
  }

  let sorted = (first + 1);
  while (sorted !== last) {
    let tempNode = nodes[sorted];
    let tempKey = getkey(tempNode);

    let next = sorted;
    let current = (sorted - 1);

    while (next !== first && tempKey < getkey(nodes[current])) {
      nodes[next] = nodes[current];
      next--;
      current--;
    }

    if (next !== sorted) {
      nodes[next] = tempNode;
    }

    sorted++;
  }
}

function getkeyXfn(node) {
  let extents = node.extents;
  return (extents[0] + extents[3]);
}

function getkeyYfn(node) {
  let extents = node.extents;
  return (extents[1] + extents[4]);
}

function getkeyZfn(node) {
  let extents = node.extents;
  return (extents[2] + extents[5]);
}

function getreversekeyXfn(node) {
  let extents = node.extents;
  return -(extents[0] + extents[3]);
}

function getreversekeyYfn(node) {
  let extents = node.extents;
  return -(extents[1] + extents[4]);
}

function getreversekeyZfn(node) {
  let extents = node.extents;
  return -(extents[2] + extents[5]);
}

AABBTree.prototype._sortNodes = function (nodes) {
  let numNodes = nodes.length;

  let reverse = false;

  function sortNodesRecursive(startIndex, endIndex, axis) {
    let splitNodeIndex = ((startIndex + endIndex) >> 1);

    if (axis === 0) {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyXfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyXfn);
      }
    } else if (axis === 2) {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyZfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyZfn);
      }
    } else {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyYfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyYfn);
      }
    }

    if (axis === 0) {
      axis = 2;
    } else if (axis === 2) {
      axis = 1;
    } else {
      axis = 0;
    }

    reverse = !reverse;

    if ((startIndex + NUM_NODES_LEAF) < splitNodeIndex) {
      sortNodesRecursive(startIndex, splitNodeIndex, axis);
    }

    if ((splitNodeIndex + NUM_NODES_LEAF) < endIndex) {
      sortNodesRecursive(splitNodeIndex, endIndex, axis);
    }
  }

  sortNodesRecursive(0, numNodes, 0);
};

AABBTree.prototype._sortNodesNoY = function (nodes) {
  let numNodes = nodes.length;

  let reverse = false;

  function sortNodesNoYRecursive(startIndex, endIndex, axis) {
    let splitNodeIndex = ((startIndex + endIndex) >> 1);

    if (axis === 0) {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyXfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyXfn);
      }
    } else {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyZfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyZfn);
      }
    }

    if (axis === 0) {
      axis = 2;
    } else {
      axis = 0;
    }

    reverse = !reverse;

    if ((startIndex + NUM_NODES_LEAF) < splitNodeIndex) {
      sortNodesNoYRecursive(startIndex, splitNodeIndex, axis);
    }

    if ((splitNodeIndex + NUM_NODES_LEAF) < endIndex) {
      sortNodesNoYRecursive(splitNodeIndex, endIndex, axis);
    }
  }

  sortNodesNoYRecursive(0, numNodes, 0);
};

function getkeyXZfn(node) {
  let extents = node.extents;
  return (extents[0] + extents[2] + extents[3] + extents[5]);
}

function getkeyZXfn(node) {
  let extents = node.extents;
  return (extents[0] - extents[2] + extents[3] - extents[5]);
}

function getreversekeyXZfn(node) {
  let extents = node.extents;
  return -(extents[0] + extents[2] + extents[3] + extents[5]);
}

function getreversekeyZXfn(node) {
  let extents = node.extents;
  return -(extents[0] - extents[2] + extents[3] - extents[5]);
}

function calculateSAH(buildNodes, startIndex, endIndex) {
  let buildNode = buildNodes[startIndex];
  let extents = buildNode.extents;
  let minX = extents[0];
  let minY = extents[1];
  let minZ = extents[2];
  let maxX = extents[3];
  let maxY = extents[4];
  let maxZ = extents[5];

  for (let n = (startIndex + 1); n < endIndex; n++) {
    buildNode = buildNodes[n];
    extents = buildNode.extents;

    if (minX > extents[0]) {
      minX = extents[0];
    }
    if (minY > extents[1]) {
      minY = extents[1];
    }
    if (minZ > extents[2]) {
      minZ = extents[2];
    }
    if (maxX < extents[3]) {
      maxX = extents[3];
    }
    if (maxY < extents[4]) {
      maxY = extents[4];
    }
    if (maxZ < extents[5]) {
      maxZ = extents[5];
    }
  }

  return ((maxX - minX) + (maxY - minY) + (maxZ - minZ));
}

AABBTree.prototype._sortNodesHighQuality = function (nodes) {
  let numNodes = nodes.length;

  let reverse = false;

  function sortNodesHighQualityRecursive(startIndex, endIndex) {
    let splitNodeIndex = ((startIndex + endIndex) >> 1);

    nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyXfn);
    let sahX = (calculateSAH(nodes, startIndex, splitNodeIndex) + calculateSAH(nodes, splitNodeIndex, endIndex));

    nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyYfn);
    let sahY = (calculateSAH(nodes, startIndex, splitNodeIndex) + calculateSAH(nodes, splitNodeIndex, endIndex));

    nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyZfn);
    let sahZ = (calculateSAH(nodes, startIndex, splitNodeIndex) + calculateSAH(nodes, splitNodeIndex, endIndex));

    nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyXZfn);
    let sahXZ = (calculateSAH(nodes, startIndex, splitNodeIndex) + calculateSAH(nodes, splitNodeIndex, endIndex));

    nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyZXfn);
    let sahZX = (calculateSAH(nodes, startIndex, splitNodeIndex) + calculateSAH(nodes, splitNodeIndex, endIndex));

    if (sahX <= sahY && sahX <= sahZ && sahX <= sahXZ && sahX <= sahZX) {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyXfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyXfn);
      }
    } else if (sahZ <= sahY && sahZ <= sahXZ && sahZ <= sahZX) {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyZfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyZfn);
      }
    } else if (sahY <= sahXZ && sahY <= sahZX) {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyYfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyYfn);
      }
    } else if (sahXZ <= sahZX) {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyXZfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyXZfn);
      }
    } else {
      if (reverse) {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getreversekeyZXfn);
      } else {
        nthElement(nodes, startIndex, splitNodeIndex, endIndex, getkeyZXfn);
      }
    }

    reverse = !reverse;

    if ((startIndex + NUM_NODES_LEAF) < splitNodeIndex) {
      sortNodesHighQualityRecursive(startIndex, splitNodeIndex);
    }

    if ((splitNodeIndex + NUM_NODES_LEAF) < endIndex) {
      sortNodesHighQualityRecursive(splitNodeIndex, endIndex);
    }
  }

  sortNodesHighQualityRecursive(0, numNodes);
};

AABBTree.prototype._recursiveBuild = function (buildNodes, startIndex, endIndex, lastNodeIndex) {
  let nodes = this.nodes;
  let nodeIndex = lastNodeIndex;
  lastNodeIndex++;

  let minX;
  let minY;
  let minZ;
  let maxX;
  let maxY;
  let maxZ;
  let extents;
  let buildNode;
  let lastNode;

  if ((startIndex + NUM_NODES_LEAF) >= endIndex) {
    buildNode = buildNodes[startIndex];
    extents = buildNode.extents;
    minX = extents[0];
    minY = extents[1];
    minZ = extents[2];
    maxX = extents[3];
    maxY = extents[4];
    maxZ = extents[5];

    buildNode.externalNode[this.spat_id] = lastNodeIndex;
    this._replaceNode(nodes, lastNodeIndex, buildNode);

    for (let n = (startIndex + 1); n < endIndex; n++) {
      buildNode = buildNodes[n];
      extents = buildNode.extents;

      if (minX > extents[0]) {
        minX = extents[0];
      }
      if (minY > extents[1]) {
        minY = extents[1];
      }
      if (minZ > extents[2]) {
        minZ = extents[2];
      }
      if (maxX < extents[3]) {
        maxX = extents[3];
      }
      if (maxY < extents[4]) {
        maxY = extents[4];
      }
      if (maxZ < extents[5]) {
        maxZ = extents[5];
      }

      lastNodeIndex++;
      buildNode.externalNode[this.spat_id] = lastNodeIndex;
      this._replaceNode(nodes, lastNodeIndex, buildNode);
    }

    lastNode = nodes[lastNodeIndex];
  } else {
    let splitPosIndex = ((startIndex + endIndex) >> 1);

    if ((startIndex + 1) >= splitPosIndex) {
      buildNode = buildNodes[startIndex];
      buildNode.externalNode[this.spat_id] = lastNodeIndex;
      this._replaceNode(nodes, lastNodeIndex, buildNode);
    } else {
      this._recursiveBuild(buildNodes, startIndex, splitPosIndex, lastNodeIndex);
    }

    lastNode = nodes[lastNodeIndex];
    extents = lastNode.extents;
    minX = extents[0];
    minY = extents[1];
    minZ = extents[2];
    maxX = extents[3];
    maxY = extents[4];
    maxZ = extents[5];

    lastNodeIndex += lastNode.escapeNodeOffset;

    if ((splitPosIndex + 1) >= endIndex) {
      buildNode = buildNodes[splitPosIndex];
      buildNode.externalNode[this.spat_id] = lastNodeIndex;
      this._replaceNode(nodes, lastNodeIndex, buildNode);
    } else {
      this._recursiveBuild(buildNodes, splitPosIndex, endIndex, lastNodeIndex);
    }

    lastNode = nodes[lastNodeIndex];
    extents = lastNode.extents;

    if (minX > extents[0]) {
      minX = extents[0];
    }
    if (minY > extents[1]) {
      minY = extents[1];
    }
    if (minZ > extents[2]) {
      minZ = extents[2];
    }
    if (maxX < extents[3]) {
      maxX = extents[3];
    }
    if (maxY < extents[4]) {
      maxY = extents[4];
    }
    if (maxZ < extents[5]) {
      maxZ = extents[5];
    }
  }

  let node = nodes[nodeIndex];
  if (node === undefined) {
    nodes[nodeIndex] = node = AABBTree.allocateNode();
  }
  node.reset(minX, minY, minZ, maxX, maxY, maxZ, (lastNodeIndex + lastNode.escapeNodeOffset - nodeIndex));
};

AABBTree.prototype._replaceNode = function (nodes, nodeIndex, newNode) {
  let oldNode = nodes[nodeIndex];
  nodes[nodeIndex] = newNode;
  if (oldNode !== undefined) {
    AABBTree.releaseNode(oldNode);
  }
};

AABBTree.prototype._predictNumNodes = function (startIndex, endIndex, lastNodeIndex) {
  lastNodeIndex++;

  if ((startIndex + NUM_NODES_LEAF) >= endIndex) {
    lastNodeIndex += (endIndex - startIndex);
  } else {
    let splitPosIndex = ((startIndex + endIndex) >> 1);

    if ((startIndex + 1) >= splitPosIndex) {
      lastNodeIndex++;
    } else {
      lastNodeIndex = this._predictNumNodes(startIndex, splitPosIndex, lastNodeIndex);
    }

    if ((splitPosIndex + 1) >= endIndex) {
      lastNodeIndex++;
    } else {
      lastNodeIndex = this._predictNumNodes(splitPosIndex, endIndex, lastNodeIndex);
    }
  }

  return lastNodeIndex;
};

AABBTree.prototype.getVisibleNodes = function (planes, visibleNodes, startIndex) {
  let numVisibleNodes = 0;
  if (this.numExternalNodes > 0) {
    let numRemovedNodes = 0;
    let start = Date.now();
    let nodes = this.nodes;
    let endNodeIndex = this.endNode;
    let numPlanes = planes.length;
    let storageIndex = (startIndex === undefined) ? visibleNodes.length : startIndex;
    let node, extents, endChildren;
    let n0, n1, n2, p0, p1, p2;
    let isInside, n, plane, d0, d1, d2, distance;
    let nodeIndex = 0;

    for (; ;) {
      node = nodes[nodeIndex];
      extents = node.extents;
      n0 = extents[0];
      n1 = extents[1];
      n2 = extents[2];
      p0 = extents[3];
      p1 = extents[4];
      p2 = extents[5];

      //isInsidePlanesAABB
      isInside = true;
      n = 0;
      do {
        plane = planes[n];
        d0 = plane[0];
        d1 = plane[1];
        d2 = plane[2];
        distance = (d0 * (d0 < 0 ? n0 : p0) + d1 * (d1 < 0 ? n1 : p1) + d2 * (d2 < 0 ? n2 : p2));
        if (distance < plane[3]) {
          isInside = false;
          break;
        }
        n++;
      } while (n < numPlanes);
      if (isInside) {
        if (node.externalNode) {
          if (node.externalNode === REMOVED_NODE) {
            ++numRemovedNodes;
          } else {
            visibleNodes[storageIndex] = node.externalNode;
            storageIndex++;
            numVisibleNodes++;
          }
          nodeIndex++;
          if (nodeIndex >= endNodeIndex) {
            break;
          }
        } else {
          //isFullyInsidePlanesAABB
          // already set: isInside = true;
          n = 0;
          do {
            plane = planes[n];
            d0 = plane[0];
            d1 = plane[1];
            d2 = plane[2];
            distance = (d0 * (d0 > 0 ? n0 : p0) + d1 * (d1 > 0 ? n1 : p1) + d2 * (d2 > 0 ? n2 : p2));
            if (distance < plane[3]) {
              isInside = false;
              break;
            }
            n++;
          } while (n < numPlanes);
          if (isInside) {
            endChildren = (nodeIndex + node.escapeNodeOffset);
            nodeIndex++;
            do {
              node = nodes[nodeIndex];
              if (node.externalNode) {
                if (node.externalNode === REMOVED_NODE) {
                  ++numRemovedNodes;
                } else {
                  visibleNodes[storageIndex] = node.externalNode;
                  storageIndex++;
                  numVisibleNodes++;
                }
              }
              nodeIndex++;
            } while (nodeIndex < endChildren);
            if (nodeIndex >= endNodeIndex) {
              break;
            }
          } else {
            nodeIndex++;
          }
        }
      } else {
        nodeIndex += node.escapeNodeOffset;
        if (nodeIndex >= endNodeIndex) {
          break;
        }
      }
    }
    let dt = Date.now() - start;
    if (numRemovedNodes > 30 && numRemovedNodes > 5 * numVisibleNodes && dt > 1) {
      // probably more time dealing with removed nodes than actual nodes, do a rebuild
      this.needsRebuild = true;
    }
    // if (dt > 1) {
    //   console.log(`AABBTree.getVisibleNodes(${this.name}) in ${dt}ms${this.needsRebuild ? ' (needs rebuild)' : ''}`);
    // }
  }
  return numVisibleNodes;
};

AABBTree.prototype.getOverlappingNodes = function (queryExtents, overlappingNodes, startIndex) {
  if (this.numExternalNodes > 0) {
    let queryMinX = queryExtents[0];
    let queryMinY = queryExtents[1];
    let queryMinZ = queryExtents[2];
    let queryMaxX = queryExtents[3];
    let queryMaxY = queryExtents[4];
    let queryMaxZ = queryExtents[5];
    let nodes = this.nodes;
    let endNodeIndex = this.endNode;
    let node, extents, endChildren;
    let numOverlappingNodes = 0;
    let storageIndex = (startIndex === undefined) ? overlappingNodes.length : startIndex;
    let nodeIndex = 0;
    for (; ;) {
      node = nodes[nodeIndex];
      extents = node.extents;
      let minX = extents[0];
      let minY = extents[1];
      let minZ = extents[2];
      let maxX = extents[3];
      let maxY = extents[4];
      let maxZ = extents[5];
      if (queryMinX <= maxX && queryMinY <= maxY && queryMinZ <= maxZ && queryMaxX >= minX && queryMaxY >= minY && queryMaxZ >= minZ) {
        if (node.externalNode) {
          if (node.externalNode !== REMOVED_NODE) {
            overlappingNodes[storageIndex] = node.externalNode;
            storageIndex++;
            numOverlappingNodes++;
          }
          nodeIndex++;
          if (nodeIndex >= endNodeIndex) {
            break;
          }
        } else {
          if (queryMaxX >= maxX && queryMaxY >= maxY && queryMaxZ >= maxZ && queryMinX <= minX && queryMinY <= minY && queryMinZ <= minZ) {
            endChildren = (nodeIndex + node.escapeNodeOffset);
            nodeIndex++;
            do {
              node = nodes[nodeIndex];
              if (node.externalNode && node.externalNode !== REMOVED_NODE) {
                overlappingNodes[storageIndex] = node.externalNode;
                storageIndex++;
                numOverlappingNodes++;
              }
              nodeIndex++;
            } while (nodeIndex < endChildren);
            if (nodeIndex >= endNodeIndex) {
              break;
            }
          } else {
            nodeIndex++;
          }
        }
      } else {
        nodeIndex += node.escapeNodeOffset;
        if (nodeIndex >= endNodeIndex) {
          break;
        }
      }
    }
    return numOverlappingNodes;
  } else {
    return 0;
  }
};

// Would need updates for REMOVED_NODE
// AABBTree.prototype.getSphereOverlappingNodes = function (center, radius, overlappingNodes) {
//   if (this.numExternalNodes > 0) {
//     let radiusSquared = (radius * radius);
//     let centerX = center[0];
//     let centerY = center[1];
//     let centerZ = center[2];
//     let nodes = this.nodes;
//     let endNodeIndex = this.endNode;
//     let node, extents;
//     let numOverlappingNodes = overlappingNodes.length;
//     let nodeIndex = 0;
//     for (; ;) {
//       node = nodes[nodeIndex];
//       extents = node.extents;
//       let minX = extents[0];
//       let minY = extents[1];
//       let minZ = extents[2];
//       let maxX = extents[3];
//       let maxY = extents[4];
//       let maxZ = extents[5];
//       let totalDistance = 0,
//         sideDistance;
//       if (centerX < minX) {
//         sideDistance = (minX - centerX);
//         totalDistance += (sideDistance * sideDistance);
//       } else if (centerX > maxX) {
//         sideDistance = (centerX - maxX);
//         totalDistance += (sideDistance * sideDistance);
//       }
//       if (centerY < minY) {
//         sideDistance = (minY - centerY);
//         totalDistance += (sideDistance * sideDistance);
//       } else if (centerY > maxY) {
//         sideDistance = (centerY - maxY);
//         totalDistance += (sideDistance * sideDistance);
//       }
//       if (centerZ < minZ) {
//         sideDistance = (minZ - centerZ);
//         totalDistance += (sideDistance * sideDistance);
//       } else if (centerZ > maxZ) {
//         sideDistance = (centerZ - maxZ);
//         totalDistance += (sideDistance * sideDistance);
//       }
//       if (totalDistance <= radiusSquared) {
//         nodeIndex++;
//         if (node.externalNode) {
//           overlappingNodes[numOverlappingNodes] = node.externalNode;
//           numOverlappingNodes++;
//           if (nodeIndex >= endNodeIndex) {
//             break;
//           }
//         }
//       } else {
//         nodeIndex += node.escapeNodeOffset;
//         if (nodeIndex >= endNodeIndex) {
//           break;
//         }
//       }
//     }
//   }
// };

// Would need updates for REMOVED_NODE
// AABBTree.prototype.getOverlappingPairs = function (overlappingPairs, startIndex) {
//   if (this.numExternalNodes > 0) {
//     let nodes = this.nodes;
//     let endNodeIndex = this.endNode;
//     let currentNode, currentExternalNode, node, extents;
//     let numInsertions = 0;
//     let storageIndex = (startIndex === undefined) ? overlappingPairs.length : startIndex;
//     let currentNodeIndex = 0,
//       nodeIndex;
//     for (; ;) {
//       currentNode = nodes[currentNodeIndex];
//       while (!currentNode.externalNode) {
//         currentNodeIndex++;
//         currentNode = nodes[currentNodeIndex];
//       }
//
//       currentNodeIndex++;
//       if (currentNodeIndex < endNodeIndex) {
//         currentExternalNode = currentNode.externalNode;
//         extents = currentNode.extents;
//         let minX = extents[0];
//         let minY = extents[1];
//         let minZ = extents[2];
//         let maxX = extents[3];
//         let maxY = extents[4];
//         let maxZ = extents[5];
//
//         nodeIndex = currentNodeIndex;
//         for (; ;) {
//           node = nodes[nodeIndex];
//           extents = node.extents;
//           if (minX <= extents[3] && minY <= extents[4] && minZ <= extents[5] && maxX >= extents[0] && maxY >= extents[1] && maxZ >= extents[2]) {
//             nodeIndex++;
//             if (node.externalNode) {
//               overlappingPairs[storageIndex] = currentExternalNode;
//               overlappingPairs[storageIndex + 1] = node.externalNode;
//j               storageIndex += 2;
//               numInsertions += 2;
//               if (nodeIndex >= endNodeIndex) {
//                 break;
//               }
//             }
//           } else {
//             nodeIndex += node.escapeNodeOffset;
//             if (nodeIndex >= endNodeIndex) {
//               break;
//             }
//           }
//         }
//       } else {
//         break;
//       }
//     }
//     return numInsertions;
//   } else {
//     return 0;
//   }
// };

AABBTree.prototype.getExtents = function () {
  return (this.nodes.length > 0 ? this.nodes[0].extents : null);
};

AABBTree.prototype.getRootNode = function () {
  return this.nodes[0];
};

AABBTree.prototype.getNodes = function () {
  return this.nodes;
};

AABBTree.prototype.getEndNodeIndex = function () {
  return this.endNode;
};

AABBTree.prototype.getNumLeaves = function () {
  return this.numExternalNodes;
};

AABBTree.prototype.clear = function () {
  if (this.nodes.length) {
    AABBTree.recycleNodes(this.nodes, 0);
  }
  this.endNode = 0;
  this.needsRebuild = false;
  this.needsRebound = false;
  this.numAdds = 0;
  this.numUpdates = 0;
  this.numExternalNodes = 0;
  this.startUpdate = 0x7FFFFFFF;
  this.endUpdate = -0x7FFFFFFF;
};

AABBTree.rayTest = function (trees, ray, callback) {
  // convert ray to parametric form
  let origin = ray.origin;
  let direction = ray.direction;

  // values used throughout calculations.
  let o0 = origin[0];
  let o1 = origin[1];
  let o2 = origin[2];
  let d0 = direction[0];
  let d1 = direction[1];
  let d2 = direction[2];
  let id0 = 1 / d0;
  let id1 = 1 / d1;
  let id2 = 1 / d2;

  // evaluate distance factor to a node's extents from ray origin, along direction
  // use this to induce an ordering on which nodes to check.
  function distanceExtents(extents, upperBound) {
    let min0 = extents[0];
    let min1 = extents[1];
    let min2 = extents[2];
    let max0 = extents[3];
    let max1 = extents[4];
    let max2 = extents[5];

    // treat origin internal to extents as 0 distance.
    if (min0 <= o0 && o0 <= max0 && min1 <= o1 && o1 <= max1 && min2 <= o2 && o2 <= max2) {
      return 0.0;
    }

    let tmin, tmax;
    let tymin, tymax;
    let del;
    if (d0 >= 0) {
      // Deal with cases where d0 == 0
      del = (min0 - o0);
      tmin = ((del === 0) ? 0 : (del * id0));
      del = (max0 - o0);
      tmax = ((del === 0) ? 0 : (del * id0));
    } else {
      tmin = ((max0 - o0) * id0);
      tmax = ((min0 - o0) * id0);
    }

    if (d1 >= 0) {
      // Deal with cases where d1 == 0
      del = (min1 - o1);
      tymin = ((del === 0) ? 0 : (del * id1));
      del = (max1 - o1);
      tymax = ((del === 0) ? 0 : (del * id1));
    } else {
      tymin = ((max1 - o1) * id1);
      tymax = ((min1 - o1) * id1);
    }

    if ((tmin > tymax) || (tymin > tmax)) {
      return undefined;
    }

    if (tymin > tmin) {
      tmin = tymin;
    }

    if (tymax < tmax) {
      tmax = tymax;
    }

    let tzmin, tzmax;
    if (d2 >= 0) {
      // Deal with cases where d2 == 0
      del = (min2 - o2);
      tzmin = ((del === 0) ? 0 : (del * id2));
      del = (max2 - o2);
      tzmax = ((del === 0) ? 0 : (del * id2));
    } else {
      tzmin = ((max2 - o2) * id2);
      tzmax = ((min2 - o2) * id2);
    }

    if ((tmin > tzmax) || (tzmin > tmax)) {
      return undefined;
    }

    if (tzmin > tmin) {
      tmin = tzmin;
    }

    if (tzmax < tmax) {
      tmax = tzmax;
    }

    if (tmin < 0) {
      tmin = tmax;
    }

    return (tmin >= 0 && tmin < upperBound) ? tmin : undefined;
  }

  // we traverse both trees at once
  // keeping a priority list of nodes to check next.
  // TODO: possibly implement priority list more effeciently?
  //       binary heap probably too much overhead in typical case.
  let priorityList = [];

  //current upperBound on distance to first intersection
  //and current closest object properties
  let minimumResult = null;

  //if node is a leaf, intersect ray with shape
  // otherwise insert node into priority list.
  function processNode(tree, nodeIndex, upperBound) {
    let nodes = tree.getNodes();
    let node = nodes[nodeIndex];
    let distance = distanceExtents(node.extents, upperBound);
    if (distance === undefined) {
      return upperBound;
    }

    if (node.externalNode) {
      if (node.externalNode !== REMOVED_NODE) {
        let result = callback(tree, node.externalNode, ray, distance, upperBound);
        if (result) {
          minimumResult = result;
          upperBound = result.factor;
        }
      }
    } else {
      // TODO: change to binary search?
      let length = priorityList.length;
      let i;
      for (i = 0; i < length; i++) {
        let curObj = priorityList[i];
        if (distance > curObj.distance) {
          break;
        }
      }

      //insert node at index i
      priorityList.splice(i - 1, 0, {
        tree: tree,
        nodeIndex: nodeIndex,
        distance: distance
      });
    }

    return upperBound;
  }

  let upperBound = ray.maxFactor;

  let tree;
  let i;
  for (i = 0; i < trees.length; i++) {
    tree = trees[i];
    if (tree.endNode !== 0) {
      upperBound = processNode(tree, 0, upperBound);
    }
  }

  while (priorityList.length !== 0) {
    let nodeObj = priorityList.pop();

    // A node inserted into priority list after this one may have
    // moved the upper bound.
    if (nodeObj.distance >= upperBound) {
      continue;
    }

    let nodeIndex = nodeObj.nodeIndex;
    tree = nodeObj.tree;
    let nodes = tree.getNodes();

    let node = nodes[nodeIndex];
    let maxIndex = nodeIndex + node.escapeNodeOffset;

    let childIndex = nodeIndex + 1;
    do {
      upperBound = processNode(tree, childIndex, upperBound);
      childIndex += nodes[childIndex].escapeNodeOffset;
    } while (childIndex < maxIndex);
  }

  return minimumResult;
};

export function create(params) {
  return new AABBTree(params);
}
