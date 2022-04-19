// From https://github.com/guyonroche/imagejs/blob/master/lib/resize.js
// Modified to properly treat pixel centers

module.exports = {
  nearestNeighbor: function (src, dst, options) {

    let wSrc = src.width;
    let hSrc = src.height;
    //console.log("wSrc="+wSrc + ", hSrc="+hSrc);

    let wDst = dst.width;
    let hDst = dst.height;
    //console.log("wDst="+wDst + ", hDst="+hDst);

    let bufSrc = src.data;
    let bufDst = dst.data;

    for (let i = 0; i < hDst; i++) {
      for (let j = 0; j < wDst; j++) {
        let posDst = (i * wDst + j) * 4;

        let iSrc = Math.round(i * hSrc / hDst);
        let jSrc = Math.round(j * wSrc / wDst);
        let posSrc = (iSrc * wSrc + jSrc) * 4;

        bufDst[posDst++] = bufSrc[posSrc++];
        bufDst[posDst++] = bufSrc[posSrc++];
        bufDst[posDst++] = bufSrc[posSrc++];
        bufDst[posDst++] = bufSrc[posSrc++];
      }
    }
  },
  bilinearInterpolation: function (src, dst) {

    let wSrc = src.width;
    let hSrc = src.height;
    //console.log("wSrc="+wSrc + ", hSrc="+hSrc);

    let wDst = dst.width;
    let hDst = dst.height;
    //console.log("wDst="+wDst + ", hDst="+hDst);

    let bufSrc = src.data;
    let bufDst = dst.data;

    function interpolate(k, kMin, vMin, kMax, vMax) {
      // special case - k is integer
      if (kMin === kMax) {
        return vMin;
      }

      return Math.round((k - kMin) * vMax + (kMax - k) * vMin);
    }
    function assign(pos, offset, x, xMin, xMax, y, yMin, yMax) {
      let posMin = (yMin * wSrc + xMin) * 4 + offset;
      let posMax = (yMin * wSrc + xMax) * 4 + offset;
      let vMin = interpolate(x, xMin, bufSrc[posMin], xMax, bufSrc[posMax]);

      // special case, y is integer
      if (yMax === yMin) {
        bufDst[pos+offset] = vMin;
      } else {
        posMin = (yMax * wSrc + xMin) * 4 + offset;
        posMax = (yMax * wSrc + xMax) * 4 + offset;
        let vMax = interpolate(x, xMin, bufSrc[posMin], xMax, bufSrc[posMax]);

        bufDst[pos+offset] = interpolate(y, yMin, vMin, yMax, vMax);
      }
    }

    for (let i = 0; i < hDst; i++) {
      for (let j = 0; j < wDst; j++) {
        let posDst = (i * wDst + j) * 4;

        // x & y in src coordinates
        let x = (j + 0.5) * wSrc / wDst - 0.5;
        let xMin = Math.floor(x);
        let xMax = Math.min(Math.ceil(x), wSrc-1);

        let y = (i + 0.5) * hSrc / hDst - 0.5;
        let yMin = Math.floor(y);
        let yMax = Math.min(Math.ceil(y), hSrc-1);

        assign(posDst, 0, x, xMin, xMax, y, yMin, yMax);
        assign(posDst, 1, x, xMin, xMax, y, yMin, yMax);
        assign(posDst, 2, x, xMin, xMax, y, yMin, yMax);
        assign(posDst, 3, x, xMin, xMax, y, yMin, yMax);
      }
    }
  },

  _interpolate2D: function (src, dst, options, interpolate) {

    let bufSrc = src.data;
    let bufDst = dst.data;

    let wSrc = src.width;
    let hSrc = src.height;
    //console.log("wSrc="+wSrc + ", hSrc="+hSrc + ", srcLen="+bufSrc.length);

    let wDst = dst.width;
    let hDst = dst.height;
    //console.log("wDst="+wDst + ", hDst="+hDst + ", dstLen="+bufDst.length);

    // when dst smaller than src/2, interpolate first to a multiple between 0.5 and 1.0 src, then sum squares
    let wM = Math.max(1, Math.floor(wSrc / wDst));
    let wDst2 = wDst * wM;
    let hM = Math.max(1, Math.floor(hSrc / hDst));
    let hDst2 = hDst * hM;
    //console.log("wM="+wM + ", wDst2="+wDst2 + ", hM="+hM + ", hDst2="+hDst2);

    // ===========================================================
    // Pass 1 - interpolate rows
    // buf1 has width of dst2 and height of src
    let buf1 = Buffer.alloc(wDst2 * hSrc * 4);
    for (let i = 0; i < hSrc; i++) {
      for (let j = 0; j < wDst2; j++) {
        // i in src coords, j in dst coords

        // calculate x in src coords
        // this interpolation requires 4 sample points and the two inner ones must be real
        // the outer points can be fudged for the edges.
        // therefore (wSrc-1)/wDst2
        let x = (j + 0.5) * (wSrc-1) / wDst2 - 0.5;
        let xPos = Math.floor(x);
        let t = x - xPos;
        let srcPos = (i * wSrc + xPos) * 4;

        let buf1Pos = (i * wDst2 + j) * 4;
        for (let k = 0; k < 4; k++) {
          let kPos = srcPos + k;
          // let x0 = (xPos > 0) ? bufSrc[kPos - 4] : 2*bufSrc[kPos]-bufSrc[kPos+4];
          // let x1 = bufSrc[kPos];
          let x0 = (xPos >= 1) ? bufSrc[kPos - 4] : bufSrc[kPos - xPos * 4];
          let x1 = (xPos >= 0) ? bufSrc[kPos] : bufSrc[kPos - xPos * 4];
          let x2 = bufSrc[kPos + 4];
          let x3 = (xPos < wSrc - 2) ? bufSrc[kPos + 8] : 2*bufSrc[kPos + 4]-bufSrc[kPos];
          buf1[buf1Pos+k] = interpolate(x0,x1,x2,x3,t);
        }
      }
    }
    //this._writeFile(wDst2, hSrc, buf1, "out/buf1.jpg");

    // ===========================================================
    // Pass 2 - interpolate columns
    // buf2 has width and height of dst2
    let buf2 = Buffer.alloc(wDst2 * hDst2 * 4);
    for (let i = 0; i < hDst2; i++) {
      for (let j = 0; j < wDst2; j++) {
        // i&j in dst2 coords

        // calculate y in buf1 coords
        // this interpolation requires 4 sample points and the two inner ones must be real
        // the outer points can be fudged for the edges.
        // therefore (hSrc-1)/hDst2
        let y = (i + 0.5) * (hSrc-1) / hDst2 - 0.5;
        let yPos = Math.floor(y);
        let t = y - yPos;
        let buf1Pos = (yPos * wDst2 + j) * 4;
        let buf2Pos = (i * wDst2 + j) * 4;
        for (let k = 0; k < 4; k++) {
          let kPos = buf1Pos + k;
          // let y0 = (yPos >= 1) ? buf1[kPos - wDst2*4] : 2*buf1[kPos]-buf1[kPos + wDst2*4];
          // let y1 = buf1[kPos];
          let y0 = (yPos >= 1) ? buf1[kPos - wDst2*4] : buf1[kPos - yPos * wDst2*4];
          let y1 = (yPos >= 0) ? buf1[kPos] : buf1[kPos - yPos * wDst2*4];
          let y2 = buf1[kPos + wDst2*4];
          let y3 = (yPos < hSrc-2) ? buf1[kPos + wDst2*8] : 2*buf1[kPos + wDst2*4]-buf1[kPos];
          buf2[buf2Pos + k] = interpolate(y0,y1,y2,y3,t);
        }
      }
    }
    //this._writeFile(wDst2, hDst2, buf2, "out/buf2.jpg");

    // ===========================================================
    // Pass 3 - scale to dst
    let m = wM * hM;
    if (m > 1) {
      for (let i = 0; i < hDst; i++) {
        for (let j = 0; j < wDst; j++) {
          // i&j in dst bounded coords
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let y = 0; y < hM; y++) {
            let yPos = i * hM + y;
            for (let x = 0; x < wM; x++) {
              let xPos = j * wM + x;
              let xyPos = (yPos * wDst2 + xPos) * 4;
              r += buf2[xyPos];
              g += buf2[xyPos+1];
              b += buf2[xyPos+2];
              a += buf2[xyPos+3];
            }
          }

          let pos = (i*wDst + j) * 4;
          bufDst[pos] = Math.round(r / m);
          bufDst[pos+1] = Math.round(g / m);
          bufDst[pos+2] = Math.round(b / m);
          bufDst[pos+3] = Math.round(a / m);
        }
      }
    } else {
      // replace dst buffer with buf2
      dst.data = buf2;
    }
  },

  bicubicInterpolation: function (src, dst, options) {
    let interpolateCubic = function (x0, x1, x2, x3, t) {
      let a0 = x3 - x2 - x0 + x1;
      let a1 = x0 - x1 - a0;
      let a2 = x2 - x0;
      let a3 = x1;
      return Math.max(0,Math.min(255,(a0 * (t * t * t)) + (a1 * (t * t)) + (a2 * t) + (a3)));
    };
    return this._interpolate2D(src, dst, options, interpolateCubic);
  },

  hermiteInterpolation: function (src, dst, options) {
    let interpolateHermite = function (x0, x1, x2, x3, t) {
      let c0 = x1;
      let c1 = 0.5 * (x2 - x0);
      let c2 = x0 - (2.5 * x1) + (2 * x2) - (0.5 * x3);
      let c3 = (0.5 * (x3 - x0)) + (1.5 * (x1 - x2));
      return Math.max(0,Math.min(255,Math.round((((((c3 * t) + c2) * t) + c1) * t) + c0)));
    };
    return this._interpolate2D(src, dst, options, interpolateHermite);
  },

  bezierInterpolation: function (src, dst, options) {
    // between 2 points y(n), y(n+1), use next points out, y(n-1), y(n+2)
    // to predict control points (a & b) to be placed at n+0.5
    //  ya(n) = y(n) + (y(n+1)-y(n-1))/4
    //  yb(n) = y(n+1) - (y(n+2)-y(n))/4
    // then use std bezier to interpolate [n,n+1)
    //  y(n+t) = y(n)*(1-t)^3 + 3 * ya(n)*(1-t)^2*t + 3 * yb(n)*(1-t)*t^2 + y(n+1)*t^3
    //  note the 3* factor for the two control points
    // for edge cases, can choose:
    //  y(-1) = y(0) - 2*(y(1)-y(0))
    //  y(w) = y(w-1) + 2*(y(w-1)-y(w-2))
    // but can go with y(-1) = y(0) and y(w) = y(w-1)
    let interpolateBezier = function (x0, x1, x2, x3, t) {
      // x1, x2 are the knots, use x0 and x3 to calculate control points
      let cp1 = x1 + (x2-x0)/4;
      let cp2 = x2 - (x3-x1)/4;
      let nt = 1-t;
      let c0 = x1 * nt * nt * nt;
      let c1 = 3 * cp1 * nt * nt * t;
      let c2 = 3 * cp2 * nt * t * t;
      let c3 = x2 * t * t * t;
      return Math.max(0,Math.min(255,Math.round(c0 + c1 + c2 + c3)));
    };
    return this._interpolate2D(src, dst, options, interpolateBezier);
  }
};
