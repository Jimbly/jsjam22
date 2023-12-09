// Reference if needed:
//   https://github.com/DefinitelyTyped/DefinitelyTyped/blob/a56cefca02ee51c96bd57c70eca5e109c4290c15/types/gl-matrix/index.d.ts
// (Not quite the same type names we use, though)

/* eslint-disable no-duplicate-imports */

declare module 'gl-mat3/fromMat4' {
  import type { Mat3, Mat4 } from 'glov/common/vmath';
  export default function fromMat4(a: Readonly<Mat4>): Mat3;
}
declare module 'gl-mat4/copy' {
  import type { Mat4 } from 'glov/common/vmath';
  export default function copy(out: Mat4, a: Readonly<Mat4>): Mat4;
}
declare module 'gl-mat4/invert' {
  import type { Mat4 } from 'glov/common/vmath';
  export default function invert(out: Mat4, a: Readonly<Mat4>): Mat4;
}
declare module 'gl-mat4/lookAt' {
  import type { Mat4, ROVec3 } from 'glov/common/vmath';
  export default function lookAt(out: Mat4, eye: ROVec3, center: ROVec3, up: ROVec3): Mat4;
}
declare module 'gl-mat4/multiply' {
  import type { Mat4 } from 'glov/common/vmath';
  export default function multiply(out: Mat4, a: Readonly<Mat4>, b: Readonly<Mat4>): Mat4;
}
declare module 'gl-mat4/perspective' {
  import type { Mat4 } from 'glov/common/vmath';
  export default function perspective(out: Mat4, fov_y: number, aspect: number, znear: number, zfar: number): Mat4;
}
declare module 'gl-mat4/translate' {
  import type { Mat4, ROVec3 } from 'glov/common/vmath';
  export default function translate(out: Mat4, a: Readonly<Mat4>, v: ROVec3): Mat4;
}
declare module 'gl-mat4/transpose' {
  import type { Mat4 } from 'glov/common/vmath';
  export default function transpose(out: Mat4, a: Readonly<Mat4>): Mat4;
}
